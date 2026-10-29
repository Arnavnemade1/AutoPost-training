import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Browser, type Viewport } from "./browser.js";
import { findFfmpeg } from "./tools.js";

/**
 * Records the dashboard's live view while a campaign runs: a headless browser captures one
 * JPEG per interval; FFmpeg encodes them in real time into `recording/source.webm` (VP8).
 * A late capture repeats the previous frame for every missed tick, so the source keeps
 * wall-clock time; the frame log records which frames were repeats. Accelerated exports
 * select frames for each output time and are encoded by FFmpeg. Every video is decoded
 * back and its frames counted before the manifest is written.
 */
export interface RecordingOptions {
  directory: string;
  url: string;
  viewport?: Viewport;
  intervalMs?: number;
  speeds?: number[];
  outputFps?: number;
  keepFrames?: boolean;
}
export interface VideoRecord {
  name: string;
  path: string;
  speed: number;
  fps: number;
  frames: number;
  durationSeconds: number;
  bytes: number;
  sha256: string;
}
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Runs FFmpeg; its diagnostics (and `-version`'s stdout) are returned as `stderr`. */
async function run(ffmpeg: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(ffmpeg, ["-hide_banner", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const collect = (chunk: Buffer) => (stderr = (stderr + chunk).slice(-20000));
    child.stdout!.on("data", collect);
    child.stderr!.on("data", collect);
    child.once("close", (code) => resolve({ code: code ?? 1, stderr }));
    child.once("error", (error) => resolve({ code: 1, stderr: String(error) }));
  });
}

/** Duration from the container, and the frame count from decoding every frame. */
export async function inspectVideo(
  ffmpeg: string,
  path: string,
): Promise<{ durationSeconds: number; frames: number }> {
  const header = await run(ffmpeg, ["-i", path]);
  const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(header.stderr);
  if (!match) throw new Error(`VIDEO_UNREADABLE: ${path}`);
  const durationSeconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  const scratch = await mkdtemp(join(tmpdir(), "forge-decode-"));
  try {
    const decoded = await run(ffmpeg, [
      "-loglevel",
      "error",
      "-i",
      path,
      "-vf",
      "scale=16:-1",
      join(scratch, "f%06d.png"),
    ]);
    if (decoded.code !== 0)
      throw new Error(`VIDEO_UNDECODABLE: ${path}: ${decoded.stderr.slice(-300)}`);
    return { durationSeconds, frames: (await readdir(scratch)).length };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export class Recorder {
  private readonly dir: string;
  private readonly intervalMs: number;
  private encoder: ChildProcess | null = null;
  private encoderExit: Promise<number> | null = null;
  private browser: Browser | null = null;
  private ffmpeg = "";
  private frames = 0;
  private repeats = 0;
  private startedAt = "";
  private loop: Promise<void> | null = null;
  private stopping = false;
  private failure: string | null = null;
  private last: Buffer | null = null;

  private constructor(readonly options: RecordingOptions) {
    this.dir = join(options.directory, "recording");
    this.intervalMs = options.intervalMs ?? 1000;
  }

  private async state(status: string, extra: Record<string, unknown> = {}): Promise<void> {
    const partial = join(this.dir, "state.json.partial");
    await writeFile(
      partial,
      JSON.stringify({
        status,
        error: this.failure,
        frames: this.frames,
        repeatedFrames: this.repeats,
        startedAt: this.startedAt || null,
        updatedAt: new Date().toISOString(),
        intervalMs: this.intervalMs,
        method: "headless dashboard capture (live view)",
        ...extra,
      }),
    );
    await rename(partial, join(this.dir, "state.json"));
  }

  /**
   * Preflight, then capture. On any preflight failure the state file says `failed` with the
   * reason, before the caller starts a campaign, and this throws.
   */
  static async start(options: RecordingOptions): Promise<Recorder> {
    const recorder = new Recorder(options);
    await mkdir(join(recorder.dir, "frames"), { recursive: true });
    await recorder.state("preflight");
    try {
      recorder.ffmpeg = await findFfmpeg();
      const version = await run(recorder.ffmpeg, ["-version"]);
      if (version.code !== 0) throw new Error("FFMPEG_UNUSABLE: `ffmpeg -version` failed");
      recorder.browser = await Browser.launch();
      await recorder.browser.viewport(options.viewport ?? { width: 1440, height: 900 });
      await recorder.browser.open(options.url);
      const title = await recorder.browser.evaluate<string>("document.title");
      if (!/Forge/.test(title))
        throw new Error(`DASHBOARD_UNREACHABLE: ${options.url} did not render the dashboard`);
      recorder.encoder = spawn(
        recorder.ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "image2pipe",
          "-c:v",
          "mjpeg",
          "-framerate",
          String(1000 / recorder.intervalMs),
          "-i",
          "pipe:0",
          "-c:v",
          "libvpx",
          "-b:v",
          "2M",
          "-y",
          join(recorder.dir, "source.webm"),
        ],
        { stdio: ["pipe", "ignore", "pipe"] },
      );
      let encoderError = "";
      recorder.encoder.stderr!.on(
        "data",
        (chunk) => (encoderError = (encoderError + chunk).slice(-2000)),
      );
      recorder.encoderExit = new Promise((resolve) =>
        recorder.encoder!.once("close", (code) => resolve(code ?? 1)),
      );
      recorder.encoderExit.then((code) => {
        if (!recorder.stopping)
          recorder.failure = `ENCODER_EXITED: ffmpeg exited ${code}: ${encoderError}`;
      });
      recorder.startedAt = new Date().toISOString();
      await recorder.capture(0, false);
      await Bun.sleep(300);
      if (recorder.failure) throw new Error(recorder.failure);
      await recorder.state("recording");
    } catch (error) {
      recorder.failure = String(error instanceof Error ? error.message : error).slice(0, 1000);
      await recorder.state("failed");
      recorder.stopping = true;
      recorder.encoder?.kill("SIGKILL");
      await recorder.browser?.close();
      throw new Error(`RECORDING_PREFLIGHT_FAILED: ${recorder.failure}`);
    }
    recorder.loop = recorder.capturing();
    return recorder;
  }

  private async capture(tick: number, repeat: boolean): Promise<void> {
    const frame = repeat ? this.last! : await this.browser!.screenshot("jpeg", 80);
    this.last = frame;
    this.frames += 1;
    if (repeat) this.repeats += 1;
    await writeFile(join(this.dir, "frames", `${String(this.frames).padStart(6, "0")}.jpg`), frame);
    await appendFile(
      join(this.dir, "frames.jsonl"),
      JSON.stringify({
        frame: this.frames,
        tick,
        at: new Date().toISOString(),
        repeat,
        sha256: sha256(frame),
      }) + "\n",
    );
    await new Promise<void>((resolve, reject) =>
      this.encoder!.stdin!.write(frame, (error) => (error ? reject(error) : resolve())),
    );
  }

  /** One frame per tick of wall-clock time; missed ticks repeat the previous frame. */
  private async capturing(): Promise<void> {
    const origin = Date.parse(this.startedAt);
    let tick = 1;
    while (!this.stopping && !this.failure) {
      const due = origin + tick * this.intervalMs;
      await Bun.sleep(Math.max(0, due - Date.now()));
      if (this.stopping) break;
      try {
        await this.capture(tick, false);
        tick += 1;
        while (!this.stopping && Date.now() >= origin + tick * this.intervalMs + this.intervalMs) {
          await this.capture(tick, true);
          tick += 1;
        }
        if (this.frames % 5 === 0) await this.state("recording");
      } catch (error) {
        this.failure = `CAPTURE_FAILED: ${String(error instanceof Error ? error.message : error).slice(0, 500)}`;
      }
    }
    if (this.failure) await this.state("failed");
  }

  get failed(): string | null {
    return this.failure;
  }

  /** Stops capture, finalizes the source, writes and verifies the exports and the manifest. */
  async stop(): Promise<{ videos: VideoRecord[] }> {
    this.stopping = true;
    await this.loop;
    this.encoder!.stdin!.end();
    const code = await this.encoderExit!;
    await this.browser?.close();
    if (code !== 0 && !this.failure) this.failure = `ENCODER_EXITED: ffmpeg exited ${code}`;
    if (this.failure) {
      await this.state("failed");
      throw new Error(`RECORDING_FAILED: ${this.failure}`);
    }
    const finishedAt = new Date().toISOString();
    const intervalSeconds = this.intervalMs / 1000;
    const fps = this.options.outputFps ?? 30;
    const frameFiles = (await readdir(join(this.dir, "frames")))
      .filter((f) => f.endsWith(".jpg"))
      .sort();
    const videos: VideoRecord[] = [];
    const record = async (
      name: string,
      path: string,
      speed: number,
      rate: number,
      expected: number,
    ) => {
      const inspected = await inspectVideo(this.ffmpeg, join(this.dir, path));
      if (inspected.frames !== expected)
        throw new Error(
          `VIDEO_FRAME_MISMATCH: ${path} decodes to ${inspected.frames} frames, expected ${expected}`,
        );
      const bytes = await readFile(join(this.dir, path));
      videos.push({
        name,
        path: `recording/${path}`,
        speed,
        fps: rate,
        frames: inspected.frames,
        durationSeconds: inspected.durationSeconds,
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    };
    await record("source", "source.webm", 1, 1 / intervalSeconds, frameFiles.length);
    for (const speed of this.options.speeds ?? [100, 120]) {
      // Output frame j shows the source at j * speed / fps seconds.
      const count = Math.max(1, Math.floor((frameFiles.length * intervalSeconds * fps) / speed));
      const encoder = spawn(
        this.ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "image2pipe",
          "-c:v",
          "mjpeg",
          "-framerate",
          String(fps),
          "-i",
          "pipe:0",
          "-c:v",
          "libvpx",
          "-b:v",
          "2M",
          "-y",
          join(this.dir, `export-${speed}x.webm`),
        ],
        { stdio: ["pipe", "ignore", "inherit"] },
      );
      const done = new Promise<number>((resolve) => encoder.once("close", (c) => resolve(c ?? 1)));
      for (let j = 0; j < count; j++) {
        const index = Math.min(
          frameFiles.length - 1,
          Math.floor((j * speed) / (fps * intervalSeconds)),
        );
        const frame = await readFile(join(this.dir, "frames", frameFiles[index]));
        await new Promise<void>((resolve, reject) =>
          encoder.stdin!.write(frame, (e) => (e ? reject(e) : resolve())),
        );
      }
      encoder.stdin!.end();
      if ((await done) !== 0) throw new Error(`EXPORT_FAILED: ${speed}x`);
      await record(`${speed}x`, `export-${speed}x.webm`, speed, fps, count);
    }
    const version = (await run(this.ffmpeg, ["-version"])).stderr.split("\n")[0];
    await writeFile(
      join(this.dir, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          method:
            "headless dashboard capture (live view), one JPEG per interval, VP8 WebM via FFmpeg",
          url: this.options.url,
          viewport: this.options.viewport ?? { width: 1440, height: 900 },
          intervalMs: this.intervalMs,
          startedAt: this.startedAt,
          finishedAt,
          wallSeconds: (Date.parse(finishedAt) - Date.parse(this.startedAt)) / 1000,
          frames: { total: this.frames, repeated: this.repeats, log: "recording/frames.jsonl" },
          ffmpeg: { path: this.ffmpeg, version },
          videos,
        },
        null,
        2,
      ),
    );
    if (!this.options.keepFrames)
      await rm(join(this.dir, "frames"), { recursive: true, force: true });
    await this.state("finished", { finishedAt });
    return { videos };
  }
}
