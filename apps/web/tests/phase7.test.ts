import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Browser } from "../src/browser.js";
import { inspectVideo } from "../src/recorder.js";
import { serveDashboard, type Dashboard } from "../src/server.js";
import { findFfmpeg } from "../src/tools.js";

// A real recorded campaign: Relaycast, Terse and Python GRPO on the offline tiny fixture,
// started by the same launcher a user runs, while a headless browser records the dashboard.
const python = process.env.FORGE_PYTHON;
let root: string, campaign: string;
let dashboard: Dashboard, browser: Browser;
type Doc = Record<string, any>;

const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const readJson = async (path: string): Promise<Doc> => JSON.parse(await readFile(path, "utf8"));
async function launcher(args: string[], env: Record<string, string> = {}) {
  const child = spawn(
    join(import.meta.dir, "../node_modules/.bin/bun"),
    ["scripts/record-campaign.ts", ...args],
    {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  const code = await new Promise<number>((done) => child.once("close", (c) => done(c ?? 1)));
  return { code, output };
}
const axeSource = () =>
  readFile(join(import.meta.dir, "../node_modules/axe-core/axe.min.js"), "utf8");

beforeAll(async () => {
  if (!python) throw new Error("Set FORGE_PYTHON to the training-core virtualenv Python");
  root = await mkdtemp(join(tmpdir(), "forge-phase7-"));
  campaign = join(root, "campaign");
  const run = await launcher(["fixture-grpo", "--output", campaign]);
  if (run.code !== 0)
    throw new Error(`Recorded campaign failed (${run.code}): ${run.output.slice(-2000)}`);
  dashboard = serveDashboard(campaign);
  browser = await Browser.launch();
}, 600000);
afterAll(async () => {
  await browser?.close();
  await dashboard?.stop();
  if (root) await rm(root, { recursive: true, force: true });
});

test("the source recording and its 100x and 120x exports are valid and exact", async () => {
  const manifest = await readJson(join(campaign, "recording/manifest.json"));
  const ffmpeg = await findFfmpeg();
  const [source, fast, faster] = manifest.videos as Doc[];
  expect([source.name, fast.name, faster.name]).toEqual(["source", "100x", "120x"]);
  // One frame per second of wall-clock time; repeats fill any late capture.
  expect(Math.abs(source.frames - manifest.wallSeconds)).toBeLessThanOrEqual(2);
  expect(source.durationSeconds).toBeCloseTo(source.frames, 0);
  for (const video of [source, fast, faster]) {
    const path = join(campaign, video.path);
    expect(await sha256(path)).toBe(video.sha256);
    // Decoding every frame is the playability check FFmpeg can make.
    expect(await inspectVideo(ffmpeg, path)).toEqual({
      durationSeconds: video.durationSeconds,
      frames: video.frames,
    });
  }
  for (const video of [fast, faster]) {
    expect(video.frames).toBe(Math.max(1, Math.floor((source.frames * 30) / video.speed)));
    expect(video.durationSeconds).toBeCloseTo(video.frames / 30, 1);
  }
  // And a browser plays every one of them.
  await browser.viewport({ width: 1440, height: 900 });
  await browser.open(`${dashboard.url}/#recording`);
  const played = await browser.evaluate<
    Doc[]
  >(`Promise.all([...document.querySelectorAll("video")].map((v) =>
    new Promise((ok) => { const done = () => ok({ src: v.currentSrc, duration: v.duration, width: v.videoWidth, error: v.error && v.error.code });
      if (v.readyState >= 1) done(); else { v.addEventListener("loadedmetadata", done, { once: true }); v.addEventListener("error", done, { once: true }); v.load(); } })))`);
  expect(played).toHaveLength(3);
  for (const video of played) {
    expect(video.error).toBeNull();
    expect(video.width).toBe(1440);
    expect(video.duration).toBeGreaterThan(0);
  }
});

test("displayed scores, rewards and budget equal the stored artifacts", async () => {
  const live = await readJson(join(campaign, "live/state.json"));
  expect(live.status).toBe("finished");
  await browser.viewport({ width: 1440, height: 900 });
  await browser.open(dashboard.url);
  const shown = await browser.evaluate<Doc>(`(() => {
    const read = (el) => el && { correct: Number(el.dataset.correct), total: Number(el.dataset.total), text: el.textContent };
    const scores = Object.fromEntries([...document.querySelectorAll("[data-testid^='dev-score-']")].map((el) => [el.dataset.testid.slice(10), read(el)]));
    const q = (id) => document.querySelector("[data-testid='" + id + "']");
    return { baseline: read(q("baseline-score")), scores, rollouts: { rewarded: q("rollouts-total").dataset.rewarded, rollouts: q("rollouts-total").dataset.rollouts }, used: Number(q("budget-used").dataset.microUsd),
      max: Number(q("budget-max").dataset.microUsd), promoted: q("promoted").textContent };
  })()`);
  // The frozen baseline file is the one whose hash the campaign recorded.
  const baselineName = (await readdir(campaign)).find((name) =>
    name.startsWith("frozen-baseline"),
  )!;
  const baselineFile = join(campaign, baselineName);
  expect(await sha256(baselineFile)).toBe(live.baseline.reportSha256);
  const baseline = await readJson(baselineFile);
  expect(shown.baseline).toEqual({
    correct: baseline.num_correct,
    total: baseline.num_examples,
    text: `${baseline.num_correct}/${baseline.num_examples}`,
  });
  const labels = await readdir(join(campaign, "experiments"));
  expect(Object.keys(shown.scores).sort()).toEqual([...labels].sort());
  let rewarded = 0,
    rollouts = 0;
  for (const label of labels) {
    const report = await readJson(join(campaign, "experiments", label, "evaluator/candidate.json"));
    expect(shown.scores[label]).toEqual({
      correct: report.num_correct,
      total: report.num_examples,
      text: `${report.num_correct}/${report.num_examples}`,
    });
    for (const line of (
      await readFile(join(campaign, "experiments", label, "run/rollouts.jsonl"), "utf8")
    )
      .trimEnd()
      .split("\n")) {
      rewarded += JSON.parse(line).reward;
      rollouts += 1;
    }
  }
  expect([Number(shown.rollouts.rewarded), Number(shown.rollouts.rollouts)]).toEqual([
    rewarded,
    rollouts,
  ]);
  expect(shown.used).toBe(live.campaign.spentMicroUsd + live.campaign.reservedMicroUsd);
  expect(shown.max).toBe(live.campaign.spec.maxBudgetMicroUsd);
  const report = await readJson(join(campaign, "research-report.json"));
  expect(shown.promoted).toBe(report.promoted ?? "None");
});

test("desktop, mobile and the one-screen live view render without overflow", async () => {
  for (const [path, viewport] of [
    ["/", { width: 1440, height: 900 }],
    ["/", { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 }],
    ["/?view=live", { width: 1440, height: 900 }],
  ] as const) {
    await browser.viewport(viewport);
    await browser.open(`${dashboard.url}${path}`);
    const layout =
      await browser.evaluate<Doc>(`({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
      headings: [...document.querySelectorAll("main h2")].map((h) => h.textContent) })`);
    expect(layout.width).toBeLessThanOrEqual(viewport.width);
    if (path.includes("live")) {
      expect(layout.height).toBeLessThanOrEqual(viewport.height);
      expect(layout.headings).toEqual(
        expect.arrayContaining(["Research graph", "Experiments", "Training", "Agent messages"]),
      );
    } else
      expect(layout.headings).toEqual(
        expect.arrayContaining([
          "Research graph",
          "Experiments",
          "Training metrics",
          "Environment inspector",
          "Governance",
          "Before and after",
          "Agent messages",
          "Recording",
          "Downloads",
        ]),
      );
    expect(await browser.screenshot("png")).toBeInstanceOf(Buffer);
  }
});

test("axe-core finds no accessibility violations in either color scheme", async () => {
  const axe = await axeSource();
  for (const scheme of ["light", "dark"]) {
    await browser.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }],
    });
    for (const [path, viewport] of [
      ["/", { width: 1440, height: 900 }],
      ["/", { width: 390, height: 844, mobile: true }],
      ["/?view=live", { width: 1440, height: 900 }],
    ] as const) {
      await browser.viewport(viewport);
      await browser.open(`${dashboard.url}${path}`);
      await browser.evaluate(axe);
      const violations = await browser.evaluate<Doc[]>(
        "axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))",
      );
      expect({ scheme, path, width: viewport.width, violations }).toEqual({
        scheme,
        path,
        width: viewport.width,
        violations: [],
      });
    }
  }
  await browser.send("Emulation.setEmulatedMedia", { features: [] });
});

test("the fixture is labeled, and only listed evidence files are served", async () => {
  await browser.open(dashboard.url);
  expect(
    await browser.evaluate<boolean>("!!document.querySelector(\"[data-testid='fixture-banner']\")"),
  ).toBe(true);
  const report = await fetch(`${dashboard.url}/files/research-report.json`);
  expect(report.status).toBe(200);
  expect(Buffer.from(await report.arrayBuffer())).toEqual(
    await readFile(join(campaign, "research-report.json")),
  );
  for (const path of [
    "terse/runtime.lock",
    "relay.db",
    "fixture/data/train.jsonl",
    "..%2F..%2Fetc%2Fpasswd",
  ])
    expect((await fetch(`${dashboard.url}/files/${path}`)).status).toBe(404);
});

test("a capture failure is visible before the campaign starts, and stops it", async () => {
  const failed = join(root, "unrecordable");
  const run = await launcher(["fixture-grpo", "--output", failed], {
    FORGE_FFMPEG: "/nonexistent/ffmpeg",
  });
  expect(run.code).toBe(2);
  expect(run.output).toContain("Campaign not started");
  const state = await readJson(join(failed, "recording/state.json"));
  expect(state.status).toBe("failed");
  expect(state.error).toContain("FFMPEG_NOT_FOUND");
  // Nothing of the campaign exists: no actors, no data, no experiments.
  expect((await readdir(failed)).sort()).toEqual(["recording"]);
  const shown = serveDashboard(failed);
  try {
    await browser.open(shown.url);
    const banner =
      await browser.evaluate<Doc>(`({ alert: document.querySelector("[data-testid='recording-failure']")?.textContent,
      role: document.querySelector("[data-testid='recording-failure']")?.getAttribute("role"),
      pill: document.querySelector("[data-testid='recording-status']")?.dataset.status })`);
    expect(banner.alert).toContain("FFMPEG_NOT_FOUND");
    expect(banner.alert).toContain("The campaign was not started");
    expect(banner.role).toBe("alert");
    expect(banner.pill).toBe("failed");
  } finally {
    await shown.stop();
  }
});
