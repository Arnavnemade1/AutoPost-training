import { AgentRelay } from "@agent-relay/sdk";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  clients,
  launch,
  localAuthority,
} from "../../../packages/terse-actors/scripts/local-runtime.js";
import { digest, document } from "../../../packages/terse-actors/src/core.js";
import type { Document } from "../../../packages/terse-actors/src/contracts.js";
import { POLICY_VERSION } from "../src/director.js";
import { chooseEvaluationBatch } from "../src/evaluations.js";
import { GovernanceReviewer, type RegressionSuite } from "../src/governance.js";
import { reconcile } from "../src/reconcile.js";
import { RelayDispatcher, registerParticipants } from "../src/relay.js";
import { ResearchCampaign, type ResearchProfile } from "../src/research.js";
import { TrainingBridge, pythonJson, readJson } from "../src/worker.js";
import { launchRelay } from "./local-relay.js";

const limits = { maxRevisions: 2, maxFailures: 2 };
const GSM8K_REVISION = "740312add88f781978c0658806c59bc2815b9866";
const QWEN = {
  model_id: "Qwen/Qwen2.5-0.5B-Instruct",
  revision: "7ae557604adf67be50417f59c2c2f167def9a775",
};

/** Builds the campaign template and allowed training partition for a profile. */
/** Writes JSONL records and a training-core manifest whose hash covers the exact bytes. */
async function writeDataset(directory: string, name: string, lines: string[], manifest: Document) {
  await mkdir(directory, { recursive: true });
  const records = `${lines.join("\n")}\n`;
  await writeFile(join(directory, `${name}.jsonl`), records, { flag: "wx" });
  await writeFile(
    join(directory, `${name}.manifest.json`),
    JSON.stringify({
      ...manifest,
      content_sha256: createHash("sha256").update(records).digest("hex"),
      num_examples: lines.length,
    }),
    { flag: "wx" },
  );
  return {
    records: join(directory, `${name}.jsonl`),
    manifest: join(directory, `${name}.manifest.json`),
  };
}
const regressionPolicy = { maxDropBps: 0, maxDevRegressions: 0 };

async function provision(
  name: string,
  output: string,
  python: string,
): Promise<{ profile: ResearchProfile; regression: RegressionSuite }> {
  if (name === "fixture") {
    const fixture = join(output, "fixture");
    await pythonJson(python, [
      "-c",
      "import sys,json; from pathlib import Path; from forge_training.fixtures import make_smoke_fixture; print(json.dumps({'config':str(make_smoke_fixture(Path(sys.argv[1])))}))",
      fixture,
    ]);
    const templatePath = join(fixture, "experiment.json");
    const template = await readJson(templatePath);
    await writeFile(
      templatePath,
      JSON.stringify({
        ...template,
        campaign_id: "research-fixture",
        experiment_id: "baseline",
        // Exercises the batched evaluation path and its batch-size-1 validation.
        evaluation: { ...(template.evaluation as Document), batch_size: 2 },
      }),
    );
    // Held-out synthetic problems for the regression suite; never in any training recipe.
    const regression = await writeDataset(
      join(fixture, "regression"),
      "regression",
      [7, 8].map((i) =>
        JSON.stringify({
          id: `regression-${i}`,
          question: `What is ${i} plus 1?`,
          answer: `#### ${i + 1}`,
        }),
      ),
      {
        schema_version: 1,
        dataset_id: "regression",
        purpose: "development",
        source: "forge-offline-fixture",
        source_revision: "generator-v1",
        source_split: "synthetic",
        license: "CC0-1.0",
      },
    );
    const profile: ResearchProfile = {
      name,
      campaignId: "research-fixture",
      templatePath,
      source: {
        records: join(fixture, "data/train.jsonl"),
        manifest: join(fixture, "data/train.manifest.json"),
      },
      base: { data: "full", learningRate: 0.0001, maxSteps: 3 },
      limits: { ...limits, minLearningRate: 0.00001, maxLearningRate: 0.01, maxSteps: 12 },
      costMicroUsd: 100000,
      maxExperiments: 4,
      timeouts: { runMs: 420000, evaluationMs: 300000 },
    };
    return { profile, regression: { ...regression, ...regressionPolicy } };
  }
  if (name !== "qwen") throw new Error("Profile must be 'fixture' or 'qwen'");
  const raw = join(output, "data", "gsm8k-raw"),
    data = join(output, "data", "gsm8k");
  // Official GSM8K train file only, from the pinned revision; the test split is never read.
  await pythonJson(
    python,
    [
      "-m",
      "forge_training",
      "prepare-gsm8k",
      "--output",
      raw,
      "--revision",
      GSM8K_REVISION,
      "--train-size",
      "128",
      "--dev-size",
      "32",
    ],
    { timeoutMs: 600000 },
  );
  // Same seed-42 shuffle as Phase 4: the first 16 held-out rows remain the development
  // set; the next 16 become the regression suite. Both are disjoint from training.
  const read = async (file: string) =>
    (await readFile(join(raw, file), "utf8")).trimEnd().split("\n");
  const devManifest = JSON.parse(await readFile(join(raw, "development.manifest.json"), "utf8"));
  const heldOut = await read("development.jsonl");
  await writeDataset(
    data,
    "train",
    await read("train.jsonl"),
    JSON.parse(await readFile(join(raw, "train.manifest.json"), "utf8")),
  );
  await writeDataset(data, "development", heldOut.slice(0, 16), devManifest);
  const regression = await writeDataset(data, "regression", heldOut.slice(16), {
    ...devManifest,
    dataset_id: "gsm8k-regression",
  });
  const templatePath = join(output, "template.json");
  await writeFile(
    templatePath,
    JSON.stringify(
      {
        schema_version: 1,
        campaign_id: "research-qwen-gsm8k",
        experiment_id: "baseline",
        model: { source: "hub", model_status: "instruct", ...QWEN },
        train: { records: "data/gsm8k/train.jsonl", manifest: "data/gsm8k/train.manifest.json" },
        development: {
          records: "data/gsm8k/development.jsonl",
          manifest: "data/gsm8k/development.manifest.json",
        },
        training: {
          method: "sft_lora",
          learning_rate: 0.0002,
          max_steps: 32,
          batch_size: 1,
          gradient_accumulation_steps: 1,
          max_sequence_length: 1024,
          lora_rank: 8,
          lora_alpha: 16,
          target_modules: ["q_proj", "v_proj"],
          max_seconds: 1500,
          max_training_tokens: 200000,
        },
        evaluation: {
          scorer: "forge_numeric_v1",
          max_new_tokens: 256,
          max_prompt_tokens: 1024,
          max_seconds: 1500,
          batch_size: 8,
        },
        seed: 42,
        device: "mps",
        precision: "float32",
        // The meta-device preflight counts tied embeddings twice (~630M for 494M loaded).
        max_model_parameters: 700000000,
        output_dir: "unused-template-output",
      },
      null,
      2,
    ),
  );
  const profile: ResearchProfile = {
    name,
    campaignId: "research-qwen-gsm8k",
    templatePath,
    source: { records: join(data, "train.jsonl"), manifest: join(data, "train.manifest.json") },
    base: { data: "full", learningRate: 0.0002, maxSteps: 32 },
    limits: { ...limits, minLearningRate: 0.00002, maxLearningRate: 0.002, maxSteps: 128 },
    costMicroUsd: 100000,
    maxExperiments: 4,
    timeouts: { runMs: 3600000, evaluationMs: 1800000 },
  };
  return { profile, regression: { ...regression, ...regressionPolicy } };
}

/**
 * Real Relaycast, Terse and Python optimization under the deterministic director policy.
 * No human selects experiments after start; all roles run in this one process.
 */
export async function runResearch(
  output: string,
  python: string,
  name: string,
  options: { tamperFirstReviewedCheckpoint?: boolean; cacheDir?: string | null } = {},
): Promise<Document> {
  await mkdir(output, { recursive: true });
  const provisioned = await provision(name, output, python);
  const { regression } = provisioned;
  const cacheDir = options.cacheDir ?? null;
  // Frozen untrained baseline, at the requested batch size only if it matches batch size 1.
  const batch = await chooseEvaluationBatch({
    python,
    templatePath: provisioned.profile.templatePath,
    directory: output,
    cacheDir,
    timeoutMs: provisioned.profile.timeouts.evaluationMs,
  });
  const profile: ResearchProfile = { ...provisioned.profile, templatePath: batch.templatePath };
  const baselinePath = batch.baseline.path,
    baselineSha256 = batch.baseline.sha256;
  const baseline = await readJson(baselinePath);
  // Resolved model identity: local fixture paths become absolute, exactly as workers see them.
  const template = (
    await pythonJson(python, ["-m", "forge_training", "validate", "--config", profile.templatePath])
  ).config as Document;
  const model = template.model as Document;
  const spec = {
    requirePreflight: true,
    objective: `Improve development accuracy of ${model.model_id} on ${name === "qwen" ? "GSM8K-train-derived development math" : "an offline synthetic fixture"} within budget; a valid campaign may find no improvement`,
    model: { modelId: model.model_id, revision: model.revision },
    benchmark: name === "qwen" ? "gsm8k-train-development-forge_numeric_v1" : "offline-fixture",
    policyVersion: "v1",
    allowedStrategies: ["sft_lora"],
    maxBudgetMicroUsd: profile.costMicroUsd * profile.maxExperiments,
    maxConcurrent: 1,
    maxExperiments: profile.maxExperiments,
    maxAttempts: 2,
    maxLeaseMs: 60000,
    maxRunMs: profile.timeouts.runMs,
    minImprovementBps: 100,
    baseline: {
      reportSha256: baselineSha256,
      datasetSha256: (baseline.dataset as Document).content_sha256,
      protocolSha256: digest(baseline.protocol),
      numExamples: baseline.num_examples,
      numCorrect: baseline.num_correct,
    },
  };
  const authority = localAuthority([profile.campaignId]);
  const runtime = await launch(authority, join(output, "terse"));
  let relayServer: Awaited<ReturnType<typeof launchRelay>> | undefined;
  try {
    relayServer = await launchRelay(output);
    const relay = await AgentRelay.createWorkspace({
      name: `forge-${name}-research`,
      baseUrl: relayServer.url,
    });
    const actors = clients(authority, runtime);
    const dispatcher = new RelayDispatcher(
      profile.campaignId,
      actors,
      await registerParticipants(relay),
    );
    const owner = (actor: "ResearchCampaignActor" | "GovernanceActor", payload: Document) =>
      actors.owner.command(actor, profile.campaignId, profile.campaignId, "initialize", payload);
    await owner("ResearchCampaignActor", spec);
    await owner("GovernanceActor", { objectiveSha256: digest(spec), policyVersion: "v1" });
    const bridge = new TrainingBridge(python, dispatcher, { ...profile.timeouts, leaseMs: 60000 });
    const research = new ResearchCampaign({
      output,
      python,
      profile,
      dispatcher,
      bridge,
      baselinePath,
      baselineSha256,
      directorKeyId: authority.identities.director.keyId,
      governance: new GovernanceReviewer(
        python,
        dispatcher,
        {
          objectiveSha256: digest(spec),
          policyVersion: "v1",
          regression,
          limits: profile.limits,
          source: profile.source,
          template: await readJson(profile.templatePath),
        },
        join(output, "governance"),
        profile.timeouts.evaluationMs,
        cacheDir,
      ),
      maxReviews: 2,
      faults: options,
    });
    // Verification probe after the campaign: every promotion path must refuse a veto.
    const vetoProbe = async () => {
      const results = [];
      for (const record of research.vetoed()) {
        const attempt = async (role: "director" | "coordinator") => {
          try {
            await actors[role].command(
              "ResearchCampaignActor",
              profile.campaignId,
              profile.campaignId,
              "promote",
              { experimentId: record.experimentId },
            );
            return "PROMOTED";
          } catch (error) {
            return String(error instanceof Error ? error.message : error).split(":")[0];
          }
        };
        results.push({
          label: record.label,
          director: await attempt("director"),
          coordinator: await attempt("coordinator"),
        });
      }
      return results;
    };
    const started = Date.now();
    const outcome = await research.run();
    const read = (
      actor: "ResearchLedgerActor" | "ResearchCampaignActor" | "ResearchWorkflowActor",
    ) => actors.owner.read(actor, profile.campaignId, "getSnapshot");
    const [ledger, campaign, workflow] = await Promise.all([
      read("ResearchLedgerActor"),
      read("ResearchCampaignActor"),
      read("ResearchWorkflowActor"),
    ]);
    const experiments = [];
    for (const experimentId of Object.keys(campaign!.proposals as Document)) {
      const state = (await actors.owner.read("ExperimentActor", experimentId, "getSnapshot"))!;
      const launchRecord = (await actors.owner.read(
        "ResearchLedgerActor",
        profile.campaignId,
        "getLaunch",
        [experimentId],
      ))!.launch as Document;
      const evaluation = state.evaluation as Document | null;
      experiments.push({
        label: launchRecord.label,
        experimentId,
        operator: launchRecord.operator,
        parent: launchRecord.parent,
        recipe: launchRecord.recipe,
        status: state.status,
        attempts: state.attempts,
        preflight: (workflow!.reviews as Record<string, Document>)[experimentId] ?? null,
        candidateCorrect: evaluation?.candidateCorrect ?? null,
        numExamples: evaluation?.numExamples ?? null,
        reportSha256: evaluation?.reportSha256 ?? null,
      });
    }
    const entries = Object.values(ledger!.entries as Record<string, Document>).sort(
      (a, b) => Number(a.sequence) - Number(b.sequence),
    );
    const report = document({
      phase: 4,
      profile: name,
      policyVersion: POLICY_VERSION,
      campaignId: profile.campaignId,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      baseline: {
        reportSha256: baselineSha256,
        numExamples: baseline.num_examples,
        numCorrect: baseline.num_correct,
      },
      experiments,
      ledger: entries.map((e) => ({
        sequence: e.sequence,
        entryId: e.entryId,
        kind: e.kind,
        summary: e.summary,
        parents: e.parents,
        evidence: e.evidence,
        rejected: (e.body as Document).rejected ?? null,
        counterfactuals: (e.body as Document).counterfactuals ?? null,
        launch: (e.body as Document).launch ?? null,
      })),
      stop: outcome,
      developmentSelected: outcome.selected,
      campaignStatus: campaign!.status,
      spentMicroUsd: campaign!.spentMicroUsd,
      reservedMicroUsd: campaign!.reservedMicroUsd,
      bestCheckpointPromoted: campaign!.best,
      reconciliation: await reconcile(dispatcher),
      governance: outcome.governance,
      promoted: outcome.promoted,
      faultsInjected: outcome.faultsInjected,
      vetoEnforcement: await vetoProbe(),
      evaluation: {
        batchSizeRequested: batch.requested,
        batchSizeUsed: batch.used,
        batchMatchesBatchOne: batch.identicalPredictions,
        numExamples: batch.numExamples,
        frozenBaselineCached: batch.baseline.cached,
        reusedFrozenBaselineInRuns: true,
      },
      humanSelectedExperiments: false,
      modelImprovementClaimed: false,
    });
    await writeFile(join(output, "research-report.json"), JSON.stringify(report, null, 2));
    await writeFile(join(output, "ledger.json"), JSON.stringify(ledger, null, 2));
    return report;
  } finally {
    await relayServer?.stop();
    await runtime.stop();
  }
}

if (import.meta.main) {
  const python = process.env.FORGE_PYTHON;
  if (!python) throw new Error("Set FORGE_PYTHON to the absolute training-core virtualenv Python");
  const name = process.argv[2] ?? "fixture";
  const output = resolve(
    (process.argv[3]?.startsWith("--") ? undefined : process.argv[3]) ??
      join(import.meta.dir, "../artifacts", `research-${name}-${Date.now()}`),
  );
  const report = await runResearch(output, python, name, {
    tamperFirstReviewedCheckpoint: process.argv.includes("--inject-tamper"),
    cacheDir:
      process.env.FORGE_EVALUATION_CACHE ?? join(import.meta.dir, "../artifacts/cache/evaluations"),
  });
  console.log(JSON.stringify({ output, ...report }, null, 2));
}
