import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Browser } from "../src/browser.js";
import { serveDashboard, type Dashboard } from "../src/server.js";
import { findFfmpeg } from "../src/tools.js";

// Phase 8 in the dashboard: a finalized fixture campaign started by the same launcher a user
// runs, which then builds the evidence bundle. Final-section numbers must equal training-core's
// harness files. The recording gate needs FFmpeg (installed in CI); without it the campaign
// runs unrecorded and that one test is skipped, never passed.
const python = process.env.FORGE_PYTHON;
const recorded = await findFfmpeg().then(
  () => true,
  () => false,
);
let root: string, campaign: string;
let dashboard: Dashboard, browser: Browser;
type Doc = Record<string, any>;

const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const readJson = async (path: string): Promise<Doc> => JSON.parse(await readFile(path, "utf8"));

beforeAll(async () => {
  if (!python) throw new Error("Set FORGE_PYTHON to the training-core virtualenv Python");
  root = await mkdtemp(join(tmpdir(), "forge-phase8-web-"));
  campaign = join(root, "campaign");
  const child = spawn(
    join(import.meta.dir, "../node_modules/.bin/bun"),
    [
      "scripts/record-campaign.ts",
      "fixture-final",
      "--output",
      campaign,
      ...(recorded ? [] : ["--allow-unrecorded"]),
      "--",
      "--finalize",
    ],
    { cwd: join(import.meta.dir, ".."), env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  child.stdout!.on("data", (chunk) => (log += chunk));
  child.stderr!.on("data", (chunk) => (log += chunk));
  const code = await new Promise<number>((done) => child.once("close", (c) => done(c ?? 1)));
  if (code !== 0) throw new Error(`Finalized campaign failed (${code}): ${log.slice(-2000)}`);
  dashboard = serveDashboard(campaign);
  browser = await Browser.launch();
}, 600000);
afterAll(async () => {
  await browser?.close();
  await dashboard?.stop();
  if (root) await rm(root, { recursive: true, force: true });
});

test("the final section shows exactly the harness comparisons and gate checks", async () => {
  await browser.viewport({ width: 1440, height: 900 });
  await browser.open(`${dashboard.url}/#final`);
  const shown = await browser.evaluate<Doc>(`(() => {
    const q = (id) => document.querySelector("[data-testid='" + id + "']");
    const n = (id) => q(id) && { correct: Number(q(id).dataset.correct), total: Number(q(id).dataset.total) };
    const scores = {};
    for (const run of ["development", "rehearsal"]) for (const metric of ["strict", "flexible"])
      scores[run + "-" + metric] = [n(run + "-" + metric + "-baseline"), n(run + "-" + metric + "-candidate")];
    return { scores, status: q("final-status").dataset.status, frozen: q("frozen-checkpoint").textContent,
      release: q("release-bundle").textContent, harness: q("final-harness").textContent,
      sealed: q("sealed-strict-baseline"), kpi: [n("rehearsal-baseline-kpi"), n("rehearsal-candidate-kpi")],
      checks: Object.fromEntries([...document.querySelectorAll("[data-testid='final-checks'] li")].map((li) => [li.dataset.check, li.dataset.status])) };
  })()`);
  const live = await readJson(join(campaign, "live/state.json"));
  expect(shown.status).toBe("rehearsed");
  expect(live.final.frozen.checkpointSha256.startsWith(shown.frozen)).toBe(true);
  expect(live.final.release.releaseSha256.startsWith(shown.release)).toBe(true);
  expect(shown.harness).toBe("0.4.9.2");
  // A fixture release never reaches the sealed test, so no sealed score is displayed.
  expect(shown.sealed).toBeNull();
  for (const run of ["development", "rehearsal"]) {
    const metrics = (await readJson(join(campaign, "final", run, "comparison.json"))).metrics;
    for (const metric of ["strict", "flexible"]) {
      const m = metrics[metric];
      expect(shown.scores[`${run}-${metric}`]).toEqual([
        { correct: m.baseline_correct, total: m.num_examples },
        { correct: m.candidate_correct, total: m.num_examples },
      ]);
    }
  }
  expect(shown.kpi).toEqual(shown.scores["rehearsal-strict"]);
  const checks = await readJson(join(campaign, "final/bundle/checks.json"));
  expect(shown.checks).toEqual(
    Object.fromEntries(Object.entries(checks).map(([name, check]) => [name, check.status])),
  );
});

test("the recorded one-screen live view still fits, with the rehearsal headline", async () => {
  await browser.viewport({ width: 1440, height: 900 });
  await browser.open(`${dashboard.url}/?view=live`);
  const layout = await browser.evaluate<Doc>(`({ width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight, tile: !!document.querySelector("[data-testid='rehearsal-candidate-kpi']") })`);
  expect(layout).toEqual({ width: 1440, height: 900, tile: true });
});

test.skipIf(!recorded)("the recording covers the run whose state it names", async () => {
  const manifest = await readJson(join(campaign, "recording/manifest.json"));
  expect(manifest.campaign).toEqual({
    campaignId: "research-fixture-final",
    finalStateSha256: await sha256(join(campaign, "live/state.json")),
  });
  const checks = await readJson(join(campaign, "final/bundle/checks.json"));
  expect(checks.recordingsMatchTheRun.status).toBe("passed");
});

test("bundle files download byte for byte; the evaluator's grants are never served", async () => {
  for (const path of [
    "final/bundle/checks.json",
    "final/bundle/claims.json",
    "final/bundle/checkpoint.tar.gz",
    "final/release/release.json",
  ]) {
    const response = await fetch(`${dashboard.url}/files/${path}`);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(await readFile(join(campaign, path)));
  }
  for (const path of [
    "final/release/development.jsonl",
    "final/rehearsal/plan.json",
    "terse/runtime.lock",
  ])
    expect((await fetch(`${dashboard.url}/files/${path}`)).status).toBe(404);
});

test("axe-core finds no violations with the final section, in either color scheme", async () => {
  const axe = await readFile(join(import.meta.dir, "../node_modules/axe-core/axe.min.js"), "utf8");
  for (const scheme of ["light", "dark"]) {
    await browser.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }],
    });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844, mobile: true },
    ]) {
      await browser.viewport(viewport);
      await browser.open(dashboard.url);
      const width = await browser.evaluate<number>("document.documentElement.scrollWidth");
      expect(width).toBeLessThanOrEqual(viewport.width);
      await browser.evaluate(axe);
      const violations = await browser.evaluate<Doc[]>(
        "axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))",
      );
      expect({ scheme, width: viewport.width, violations }).toEqual({
        scheme,
        width: viewport.width,
        violations: [],
      });
    }
  }
  await browser.send("Emulation.setEmulatedMedia", { features: [] });
});
