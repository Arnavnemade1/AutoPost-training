import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Builds the dashboard's view of one campaign directory from stored files only: actor
 * snapshots the campaign exported (`live/state.json`), the final report and ledger, run
 * bundles, evaluator reports, governance evidence, cost records and recordings. Nothing is
 * computed that a file does not state; every displayed score names its file and SHA-256.
 */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Doc = { [key: string]: Json };

export interface Source {
  path: string;
  sha256: string;
}
export interface Score {
  correct: number;
  total: number;
  source: Source;
}
export interface UpdatePoint {
  update: number;
  rewardSum: number;
  rollouts: number;
  loss: number | null;
}
export interface RolloutView {
  update: number;
  index: number;
  taskId: string;
  completion: string;
  answer: string;
  reward: number;
  worldId: string;
  episodeId: string;
  stateSha256: string;
}
export interface GovernanceView {
  label: string;
  experimentId: string;
  decision: string;
  reasonCodes: string[];
  checks: Record<string, boolean>;
  developmentRegressions: number | null;
  regression: { baselineCorrect: number; candidateCorrect: number; total: number } | null;
  worldRewards: { rollouts: number; transitionsInJournals: number } | null;
  source: Source;
}
export interface ExperimentView {
  label: string;
  experimentId: string | null;
  operator: string | null;
  parent: string | null;
  recipe: Doc | null;
  strategy: string | null;
  status: string;
  attempts: number | null;
  preflight: { approved: boolean; reason: string } | null;
  development: Score | null;
  /** The evaluator's count recorded in the experiment actor, when it differs from the file. */
  recordMismatch: boolean;
  maxUpdates: number | null;
  updates: UpdatePoint[];
  rolloutsSource: Source | null;
  latestRollouts: RolloutView[];
  governance: GovernanceView | null;
}
export interface LedgerEntryView {
  sequence: number;
  entryId: string;
  kind: string;
  summary: string;
  parents: string[];
  launches: string[];
}
export interface MessageView {
  sequence: number;
  kind: string;
  from: string;
  to: string;
  experiment: string;
  sent: boolean;
  acknowledged: boolean;
}
export interface ExampleView {
  id: string;
  question: string;
  reference: string;
  before: { prediction: string; correct: boolean; diagnosis: string };
  after: { prediction: string; correct: boolean; diagnosis: string };
}
export interface RecordingView {
  status: "absent" | "preflight" | "recording" | "failed" | "finished";
  error: string | null;
  frames: number | null;
  startedAt: string | null;
  updatedAt: string | null;
  exports: { name: string; path: string; durationSeconds: number; frames: number; speed: number }[];
}
export interface DownloadView {
  label: string;
  path: string;
  bytes: number;
  sha256: string;
}
export interface CampaignView {
  directory: string;
  campaignId: string | null;
  profile: string | null;
  method: string | null;
  status: string;
  updatedAt: string | null;
  fixture: boolean;
  model: { modelId: string; revision: string } | null;
  objective: string | null;
  startingAdapter: string | null;
  baseline: Score | null;
  budget: {
    maxMicroUsd: number;
    spentMicroUsd: number;
    reservedMicroUsd: number;
    measured: boolean;
  } | null;
  experiments: ExperimentView[];
  ledger: LedgerEntryView[];
  messages: MessageView[];
  examples: { label: string; rows: ExampleView[] } | null;
  stop: { rule: string; summary: string } | null;
  promoted: string | null;
  recording: RecordingView;
  downloads: DownloadView[];
  warnings: string[];
}

const hashes = new Map<string, { key: string; sha256: string }>();
/** File SHA-256, cached by size and modification time. */
async function sha256(path: string): Promise<string> {
  const info = await stat(path);
  const key = `${info.size}:${info.mtimeMs}`;
  const cached = hashes.get(path);
  if (cached?.key === key) return cached.sha256;
  const digest = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  hashes.set(path, { key, sha256: digest });
  return digest;
}
async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
async function json(path: string): Promise<Doc | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Doc;
  } catch {
    return null;
  }
}
async function lines(path: string): Promise<Doc[]> {
  try {
    const text = await readFile(path, "utf8");
    // A line still being appended is skipped, never half-parsed.
    return text
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Doc];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
const asDoc = (value: Json | undefined): Doc =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const asList = (value: Json | undefined): Json[] => (Array.isArray(value) ? value : []);
const str = (value: Json | undefined): string | null => (typeof value === "string" ? value : null);
const num = (value: Json | undefined): number | null => (typeof value === "number" ? value : null);

export async function loadCampaign(directory: string): Promise<CampaignView> {
  const rel = (path: string) => relative(directory, path).split(sep).join("/");
  const source = async (path: string): Promise<Source> => ({
    path: rel(path),
    sha256: await sha256(path),
  });
  const live = await json(join(directory, "live/state.json"));
  const report = await json(join(directory, "research-report.json"));
  const ledgerDoc = asDoc(live?.ledger) ?? {};
  const ledgerSnapshot = Object.keys(ledgerDoc).length
    ? ledgerDoc
    : ((await json(join(directory, "ledger.json"))) ?? {});
  const campaign = asDoc(live?.campaign);
  const spec = asDoc(campaign.spec);
  const warnings: string[] = [];

  // Frozen baseline: the report whose hash the campaign recorded as its baseline.
  const recordedBaseline =
    str(asDoc(live?.baseline).reportSha256) ??
    str(asDoc(report?.baseline).reportSha256) ??
    str(asDoc(spec.baseline).reportSha256);
  let baseline: Score | null = null;
  let baselineReport: Doc | null = null;
  for (const name of (await readdir(directory).catch(() => [] as string[]))
    .filter((n) => n.startsWith("frozen-baseline"))
    .sort()) {
    const path = join(directory, name);
    if (recordedBaseline && (await sha256(path)) !== recordedBaseline) continue;
    baselineReport = await json(path);
    if (baselineReport)
      baseline = {
        correct: Number(baselineReport.num_correct),
        total: Number(baselineReport.num_examples),
        source: await source(path),
      };
    break;
  }
  if (recordedBaseline && !baseline)
    warnings.push("The recorded frozen baseline file was not found");

  // Ledger: entries and which experiments each decision launched.
  const entries = Object.values(asDoc(ledgerSnapshot.entries))
    .map(asDoc)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence));
  const launches = new Map<string, Doc>();
  const ledger: LedgerEntryView[] = entries.map((entry) => {
    const launched = asList(asDoc(entry.body).launch).map(asDoc);
    for (const launch of launched)
      if (str(launch.experimentId)) launches.set(String(launch.experimentId), launch);
    return {
      sequence: Number(entry.sequence),
      entryId: String(entry.entryId),
      kind: String(entry.kind),
      summary: String(entry.summary ?? ""),
      parents: asList(entry.parents).map(String),
      launches: launched.map((l) => String(l.label)),
    };
  });

  // Experiments: actor snapshots and ledger launches, else the final report, else directories.
  const actorExperiments = asDoc(live?.experiments);
  const reportExperiments = asList(report?.experiments).map(asDoc);
  const labels = new Map<string, string | null>();
  for (const [experimentId, launch] of launches) labels.set(String(launch.label), experimentId);
  for (const experiment of reportExperiments)
    labels.set(String(experiment.label), str(experiment.experimentId));
  for (const name of await readdir(join(directory, "experiments")).catch(() => [] as string[]))
    if (!labels.has(name)) labels.set(name, null);
  const reviews = asDoc(asDoc(live?.workflow).reviews);

  const experiments: ExperimentView[] = [];
  for (const [label, experimentId] of labels) {
    const fromReport = reportExperiments.find((e) => e.label === label) ?? {};
    const launch = experimentId ? (launches.get(experimentId) ?? {}) : {};
    const actor = experimentId ? asDoc(actorExperiments[experimentId]) : {};
    const run = join(directory, "experiments", label, "run");
    const evaluatorPath = join(directory, "experiments", label, "evaluator", "candidate.json");
    let development: Score | null = null;
    let recordMismatch = false;
    if (await exists(evaluatorPath)) {
      const evaluated = await json(evaluatorPath);
      if (evaluated) {
        development = {
          correct: Number(evaluated.num_correct),
          total: Number(evaluated.num_examples),
          source: await source(evaluatorPath),
        };
        const recorded =
          num(asDoc(actor.evaluation).candidateCorrect) ?? num(fromReport.candidateCorrect);
        recordMismatch = recorded !== null && recorded !== development.correct;
        if (recordMismatch)
          warnings.push(`${label}: actor record differs from the evaluator report file`);
      }
    }
    const metrics = await lines(join(run, "training-metrics.jsonl"));
    const rolloutsPath = join(run, "rollouts.jsonl");
    const rollouts = await lines(rolloutsPath);
    const lastUpdate = rollouts.length ? Number(rollouts.at(-1)!.update) : null;
    const config = await json(join(directory, "experiments", label, "experiment.json"));
    const preflight = experimentId ? asDoc(reviews[experimentId]) : asDoc(fromReport.preflight);
    let governance: GovernanceView | null = null;
    const bundlePath = experimentId ? join(directory, "governance", `${experimentId}.json`) : null;
    if (bundlePath && (await exists(bundlePath))) {
      const bundle = (await json(bundlePath))!;
      const facts = asDoc(bundle.facts);
      const suite = asDoc(facts.regressionSuite);
      const world = asDoc(facts.worldRewards);
      governance = {
        label,
        experimentId: experimentId!,
        decision: String(bundle.decision),
        reasonCodes: asList(bundle.reasonCodes).map(String),
        checks: Object.fromEntries(
          Object.entries(asDoc(bundle.checks)).map(([k, v]) => [k, v === true]),
        ),
        developmentRegressions: num(facts.developmentRegressions),
        regression:
          num(suite.numExamples) !== null
            ? {
                baselineCorrect: Number(suite.baselineCorrect),
                candidateCorrect: Number(suite.candidateCorrect),
                total: Number(suite.numExamples),
              }
            : null,
        worldRewards:
          num(world.rollouts) !== null
            ? {
                rollouts: Number(world.rollouts),
                transitionsInJournals: Number(world.transitionsInJournals),
              }
            : null,
        source: await source(bundlePath),
      };
    }
    experiments.push({
      label,
      experimentId,
      operator: str(launch.operator) ?? str(fromReport.operator),
      parent: str(launch.parent) ?? str(fromReport.parent),
      recipe: Object.keys(asDoc(launch.recipe)).length
        ? asDoc(launch.recipe)
        : Object.keys(asDoc(fromReport.recipe)).length
          ? asDoc(fromReport.recipe)
          : null,
      strategy: str(asDoc(actor.proposal).strategy) ?? str(fromReport.strategy),
      status:
        str(actor.status) ??
        str(fromReport.status) ??
        (development ? "evaluated" : metrics.length ? "running" : "prepared"),
      attempts: num(actor.attempts) ?? num(fromReport.attempts),
      preflight:
        typeof preflight.approved === "boolean"
          ? { approved: preflight.approved, reason: String(preflight.reason ?? "") }
          : null,
      development,
      recordMismatch,
      maxUpdates: num(asDoc(config?.training).max_steps),
      updates: metrics.map((m) => ({
        update: Number(m.step),
        rewardSum: num(m.reward_sum) ?? 0,
        rollouts: num(m.rollouts) ?? 0,
        loss: num(m.loss),
      })),
      rolloutsSource: rollouts.length ? await source(rolloutsPath) : null,
      latestRollouts: rollouts
        .filter((r) => Number(r.update) === lastUpdate)
        .map((r) => {
          const transition = asDoc(r.transition);
          return {
            update: Number(r.update),
            index: Number(r.index),
            taskId: String(r.task_id),
            completion: String(r.completion ?? ""),
            answer: String(asDoc(r.action).answer ?? ""),
            reward: Number(r.reward),
            worldId: String(transition.worldId ?? ""),
            episodeId: String(transition.episodeId ?? ""),
            stateSha256: String(transition.stateSha256 ?? ""),
          };
        }),
      governance,
    });
  }
  experiments.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  // Agent messages: the durable workflow outbox, in causal order.
  const messages: MessageView[] = Object.values(asDoc(asDoc(live?.workflow).deliveries))
    .map(asDoc)
    .map((delivery) => {
      const message = asDoc(delivery.message);
      const experimentId = String(message.experimentId ?? "");
      const launch = launches.get(experimentId);
      return {
        sequence: Number(delivery.sequence),
        kind: String(message.kind),
        from: String(message.senderRole),
        to: String(message.recipientRole),
        experiment: launch ? String(launch.label) : experimentId.replace(/^exp-[a-f0-9]{32}-/, ""),
        sent: typeof delivery.relayMessageId === "string",
        acknowledged: delivery.acknowledged === true,
      };
    })
    .sort((a, b) => a.sequence - b.sequence);

  // Before/after: development-selected (or best evaluated) candidate against the baseline.
  const stopEntry = entries.find((e) => e.kind === "stop");
  const selectedLabel =
    str(asDoc(report?.stop).selected) ??
    str(asDoc(asDoc(stopEntry?.body).selected).label) ??
    [...experiments]
      .filter((e) => e.development)
      .sort((a, b) => b.development!.correct - a.development!.correct)[0]?.label ??
    null;
  let examples: CampaignView["examples"] = null;
  const selected = experiments.find((e) => e.label === selectedLabel);
  if (selected?.development && baselineReport) {
    const after = (await json(join(directory, selected.development.source.path)))!;
    const afterById = new Map(
      asList(after.samples)
        .map(asDoc)
        .map((s) => [String(s.id), s]),
    );
    examples = {
      label: selected.label,
      rows: asList(baselineReport.samples)
        .map(asDoc)
        .map((before) => {
          const later = afterById.get(String(before.id)) ?? {};
          return {
            id: String(before.id),
            question: String(before.question),
            reference: String(before.reference_answer),
            before: {
              prediction: String(before.prediction),
              correct: before.correct === true,
              diagnosis: String(before.diagnosis),
            },
            after: {
              prediction: String(later.prediction ?? ""),
              correct: later.correct === true,
              diagnosis: String(later.diagnosis ?? ""),
            },
          };
        }),
    };
  }

  // Budget: the campaign actor's own accounting; local cost is never measured.
  const costs = await Promise.all(
    (await readdir(join(directory, "cost")).catch(() => [] as string[])).map((n) =>
      json(join(directory, "cost", n)),
    ),
  );
  const budget =
    num(spec.maxBudgetMicroUsd) !== null
      ? {
          maxMicroUsd: Number(spec.maxBudgetMicroUsd),
          spentMicroUsd: Number(campaign.spentMicroUsd ?? 0),
          reservedMicroUsd: Number(campaign.reservedMicroUsd ?? 0),
          measured: costs.length > 0 && costs.every((c) => c?.measured === true),
        }
      : num(report?.spentMicroUsd) !== null
        ? {
            maxMicroUsd: Number.NaN,
            spentMicroUsd: Number(report!.spentMicroUsd),
            reservedMicroUsd: Number(report!.reservedMicroUsd ?? 0),
            measured: false,
          }
        : null;

  // Recording state and its verified exports.
  const state = await json(join(directory, "recording/state.json"));
  const manifest = await json(join(directory, "recording/manifest.json"));
  const recording: RecordingView = {
    status: (str(state?.status) as RecordingView["status"]) ?? "absent",
    error: str(state?.error),
    frames: num(state?.frames),
    startedAt: str(state?.startedAt),
    updatedAt: str(state?.updatedAt),
    exports: asList(manifest?.videos)
      .map(asDoc)
      .map((v) => ({
        name: String(v.name),
        path: String(v.path),
        durationSeconds: Number(v.durationSeconds),
        frames: Number(v.frames),
        speed: Number(v.speed),
      })),
  };

  // Downloads: the evidence files a reviewer would ask for, with their hashes.
  const candidates: [string, string][] = [
    ["Final report", "research-report.json"],
    ["Research ledger", "ledger.json"],
    ["Actor snapshots", "live/state.json"],
    ...(baseline ? ([["Frozen baseline", baseline.source.path]] as [string, string][]) : []),
    ...experiments.flatMap((e): [string, string][] => [
      [`${e.label} run manifest`, `experiments/${e.label}/run/manifest.json`],
      [`${e.label} adapter`, `experiments/${e.label}/run/checkpoint/adapter_model.safetensors`],
      [`${e.label} rollouts`, `experiments/${e.label}/run/rollouts.jsonl`],
      [`${e.label} evaluator report`, `experiments/${e.label}/evaluator/candidate.json`],
      ...(e.governance
        ? ([[`${e.label} governance evidence`, e.governance.source.path]] as [string, string][])
        : []),
    ]),
    ["Recording manifest", "recording/manifest.json"],
    ...recording.exports.map((v): [string, string] => [`Recording ${v.name}`, v.path]),
  ];
  const downloads: DownloadView[] = [];
  for (const [label, path] of candidates) {
    const full = join(directory, path);
    if (!(await exists(full))) continue;
    downloads.push({ label, path, bytes: (await stat(full)).size, sha256: await sha256(full) });
  }

  const model = asDoc(live?.model);
  const baselineModel = asDoc(baselineReport?.model);
  return {
    directory,
    campaignId: str(live?.campaignId) ?? str(report?.campaignId),
    profile: str(live?.profile) ?? str(report?.profile),
    method: str(live?.method) ?? str(report?.method),
    status: str(live?.status) ?? (report ? "finished" : "waiting"),
    updatedAt: str(live?.updatedAt),
    fixture: (str(model.status) ?? str(baselineModel.model_status)) === "fixture",
    model:
      (str(model.modelId) ?? str(baselineModel.model_id))
        ? {
            modelId: String(str(model.modelId) ?? baselineModel.model_id),
            revision: String(str(model.revision) ?? baselineModel.revision),
          }
        : null,
    objective: str(spec.objective),
    startingAdapter:
      str(asDoc(live?.startingAdapter).sha256) ?? str(asDoc(report?.startingAdapter).sha256),
    baseline,
    budget,
    experiments,
    ledger,
    messages,
    examples,
    stop: stopEntry
      ? { rule: String(asDoc(stopEntry.body).rule), summary: String(stopEntry.summary) }
      : null,
    promoted: str(asDoc(stopEntry?.body).promoted) ?? str(report?.promoted),
    recording,
    downloads,
    warnings,
  };
}
