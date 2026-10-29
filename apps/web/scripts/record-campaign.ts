import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Recorder } from "../src/recorder.js";
import { serveDashboard } from "../src/server.js";

/**
 * Records a research campaign as it runs: the dashboard serves the campaign directory, a
 * recorder captures its live view, then the campaign starts. A recording that cannot start
 * is reported in the dashboard and the campaign is not started (exit 2), unless
 * `--allow-unrecorded`. Usage:
 *   bun scripts/record-campaign.ts <profile> [--output <dir>] [--allow-unrecorded] [-- <research args>]
 */
const orchestrator = resolve(import.meta.dir, "../../../services/orchestrator");
const args = process.argv.slice(2);
const separator = args.indexOf("--");
const own = separator >= 0 ? args.slice(0, separator) : args;
const research = separator >= 0 ? args.slice(separator + 1) : [];
const profile = own[0];
if (!profile)
  throw new Error(
    "Usage: bun scripts/record-campaign.ts <profile> [--output <dir>] [-- <research args>]",
  );
const flag = own.indexOf("--output");
const output = resolve(
  flag > 0 ? own[flag + 1] : join(orchestrator, "artifacts", `recorded-${profile}-${Date.now()}`),
);
await mkdir(output, { recursive: true });
const dashboard = serveDashboard(output);
let recorder: Recorder | null = null;
try {
  recorder = await Recorder.start({ directory: output, url: `${dashboard.url}/?view=live` });
} catch (error) {
  console.error(`${error instanceof Error ? error.message : error}`);
  if (!own.includes("--allow-unrecorded")) {
    console.error(
      `Campaign not started. The failure is shown at ${dashboard.url} until this exits.`,
    );
    await Bun.sleep(Number(process.env.FORGE_FAILURE_DISPLAY_MS ?? 0));
    await dashboard.stop();
    process.exit(2);
  }
}
console.log(
  JSON.stringify({
    output,
    dashboard: dashboard.url,
    recording: recorder ? "recording" : "unrecorded",
  }),
);
const campaign = spawn(
  join(orchestrator, "node_modules/.bin/bun"),
  ["scripts/research.ts", profile, output, ...research],
  { cwd: orchestrator, stdio: ["ignore", "pipe", "pipe"], env: process.env },
);
let log = "";
campaign.stdout!.on("data", (chunk) => (log += chunk));
campaign.stderr!.on("data", (chunk) => (log += chunk));
const code = await new Promise<number>((done) => campaign.once("close", (c) => done(c ?? 1)));
await writeFile(join(output, "campaign.log"), log);
// Keep the final state on screen for a few frames.
await Bun.sleep(3000);
let videos: unknown = null;
let failure: string | null = null;
if (recorder) {
  try {
    videos = (await recorder.stop()).videos;
  } catch (error) {
    failure = String(error instanceof Error ? error.message : error);
  }
}
await dashboard.stop();
console.log(
  JSON.stringify({ output, campaignExit: code, videos, recordingFailure: failure }, null, 2),
);
process.exit(code !== 0 ? code : failure ? 3 : 0);
