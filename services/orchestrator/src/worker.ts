import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ForgeActorClient } from "../../../packages/terse-actors/src/client.js";
import type { Document } from "../../../packages/terse-actors/src/contracts.js";
import { digest } from "../../../packages/terse-actors/src/core.js";
import type { WorkflowMessage } from "../../../packages/terse-actors/src/workflow.js";
import { RelayDispatcher } from "./relay.js";

export async function readJson(path: string): Promise<Document> {
  return JSON.parse(await readFile(path, "utf8")) as Document;
}
export async function fileHash(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
export async function pythonJson(
  python: string,
  args: string[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Document> {
  if (!isAbsolute(python)) throw new Error("Python executable must be an absolute, trusted path");
  return await new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        TOKENIZERS_PARALLELISM: "false",
        OMP_NUM_THREADS: "1",
        MKL_NUM_THREADS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      aborted = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      aborted = true;
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 7000);
    };
    const timer = setTimeout(abort, options.timeoutMs ?? 180000);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.on("data", (value) => {
      stdout += String(value);
      if (stdout.length > 8_000_000) abort();
    });
    child.stderr.on("data", (value) => {
      stderr = (stderr + String(value)).slice(-4000);
    });
    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code) => {
      cleanup();
      if (aborted || code !== 0) {
        reject(new Error(`Python worker ${aborted ? "cancelled" : `exited ${code}`}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Document);
      } catch {
        reject(new Error("Python worker returned invalid JSON"));
      }
    });
  });
}

export interface TrainingJob {
  jobId: string;
  configPath: string;
  config: Document;
  configSha256: string;
  baselinePath: string;
  baselineSha256: string;
  trainingDatasetSha256: string;
  /** Evaluator-owned output; never inside the worker's run directory. */
  evaluatorDir: string;
}
export async function prepareJob(
  python: string,
  jobId: string,
  configPath: string,
  baselinePath: string,
  evaluatorDir: string,
  timeoutMs = 180000,
): Promise<TrainingJob> {
  const validated = await pythonJson(python, [
    "-m",
    "forge_training",
    "validate",
    "--config",
    configPath,
  ]);
  if (!(await exists(baselinePath)))
    await pythonJson(
      python,
      ["-m", "forge_training", "evaluate", "--config", configPath, "--output", baselinePath],
      { timeoutMs },
    );
  const config = validated.config as Document;
  const baseline = await readJson(baselinePath);
  // One frozen baseline serves every experiment of a campaign; protocol equality is
  // checked against each run's own baseline evaluation in `evidence`.
  if (baseline.campaign_id !== config.campaign_id || baseline.checkpoint_sha256 !== null)
    throw new Error("Baseline does not belong to this campaign's untrained model");
  return {
    jobId,
    configPath,
    config,
    configSha256: digest(config),
    baselinePath,
    baselineSha256: await fileHash(baselinePath),
    trainingDatasetSha256: String(
      ((validated.datasets as Document).train as Document).content_sha256,
    ),
    evaluatorDir,
  };
}
const predictions = (report: Document) =>
  (report.samples as Document[]).map(({ id, prediction, correct }) => ({
    id,
    prediction,
    correct,
  }));

/** Trusted local job registry: Relay messages can select IDs, never shell commands or paths. */
export class TrainingBridge {
  private readonly jobs = new Map<string, TrainingJob>();
  constructor(
    readonly python: string,
    readonly dispatcher: RelayDispatcher,
    readonly timeouts = { runMs: 420000, evaluationMs: 300000 },
  ) {}
  register(job: TrainingJob): void {
    if (this.jobs.has(job.jobId)) throw new Error("Job ID is immutable");
    this.jobs.set(job.jobId, structuredClone(job));
  }
  get(jobId: string): TrainingJob | undefined {
    const job = this.jobs.get(jobId);
    return job && structuredClone(job);
  }
  private job(message: WorkflowMessage): TrainingJob {
    const job = this.jobs.get(String(message.body.jobId));
    if (
      !job ||
      job.config.campaign_id !== message.campaignId ||
      job.config.experiment_id !== message.experimentId ||
      job.configSha256 !== message.body.configSha256
    )
      throw new Error("JOB_MISMATCH: assignment is outside the local allowlist");
    return job;
  }
  private async snapshot(actor: ForgeActorClient, id: string): Promise<Document> {
    return (await actor.read("ExperimentActor", id, "getSnapshot"))!;
  }
  /**
   * Idempotent: a terminal experiment is reconciled from its stored bundle and announced,
   * never optimized again. `afterComplete` is failure injection for a crash between the
   * authoritative completion and its announcement.
   */
  async train(message: WorkflowMessage, afterComplete?: () => Promise<void>): Promise<void> {
    if (message.kind !== "TRAINING_ASSIGNMENT") throw new Error("Expected training assignment");
    const job = this.job(message),
      { campaignId, actors } = this.dispatcher;
    const state = await this.snapshot(actors.worker, message.experimentId);
    if (state.grantId !== message.body.grantId) throw new Error("GRANT_MISMATCH");
    if (state.status === "failed") throw new Error("EXPERIMENT_FAILED: no attempts remain");
    const proposal = state.proposal as Document;
    if (proposal.configSha256 !== job.configSha256) throw new Error("CONFIG_MISMATCH");
    const model = job.config.model as Document;
    if (
      digest(proposal.model) !== digest({ modelId: model.model_id, revision: model.revision }) ||
      proposal.trainingDatasetSha256 !== job.trainingDatasetSha256
    )
      throw new Error("PROPOSAL_MISMATCH");
    if (state.status !== "completed" && state.status !== "evaluated") {
      await this.optimize(job, message, proposal);
      if (afterComplete) await afterComplete();
    }
    const evidence = await this.evidence(job),
      runDir = String(job.config.output_dir);
    await actors.worker.command(
      "ArtifactRegistryActor",
      campaignId,
      campaignId,
      "register",
      {
        artifactId: `checkpoint-${job.jobId}`,
        experimentId: message.experimentId,
        kind: "checkpoint",
        sha256: evidence.result.checkpoint_sha256,
        uri: pathToFileURL(join(runDir, "checkpoint")).href,
        sizeBytes: evidence.checkpointBytes,
        provenanceSha256: evidence.manifestSha256,
      },
      `artifact-checkpoint-${job.jobId}`,
    );
    await this.dispatcher.publish(
      "worker",
      `trained-${job.jobId}`,
      message.experimentId,
      "TRAINING_COMPLETED",
      {
        jobId: job.jobId,
        configSha256: job.configSha256,
        manifestSha256: evidence.manifestSha256,
        checkpointSha256: evidence.result.checkpoint_sha256,
      },
    );
  }
  private async optimize(job: TrainingJob, message: WorkflowMessage, proposal: Document) {
    const { campaignId, actors } = this.dispatcher,
      runDir = String(job.config.output_dir);
    const lease = await actors.worker.command(
      "ExperimentActor",
      message.experimentId,
      campaignId,
      "acquireLease",
      { leaseMs: 10000 },
    );
    const abort = new AbortController();
    let heartbeatFailure: unknown;
    let renewing = false;
    let inflight: Promise<void> = Promise.resolve();
    const timer = setInterval(() => {
      if (renewing) return;
      renewing = true;
      inflight = actors.worker
        .command("ExperimentActor", message.experimentId, campaignId, "renewLease", {
          generation: lease.generation,
          leaseMs: 10000,
        })
        .then(() => undefined)
        .catch((error) => {
          heartbeatFailure = error;
          abort.abort();
        })
        .finally(() => {
          renewing = false;
        });
    }, 2000);
    try {
      // A completed bundle from a lost completion reply is reconciled, never rerun.
      if (!(await exists(join(runDir, "manifest.json")))) {
        // Partial output from a crashed attempt is preserved evidence, never resumed or reused.
        if (await exists(runDir))
          throw new Error("PARTIAL_RUN_DIRECTORY: an earlier attempt left incomplete output");
        const validated = await pythonJson(
          this.python,
          ["-m", "forge_training", "validate", "--config", job.configPath],
          { signal: abort.signal },
        );
        if (digest(validated.config) !== job.configSha256)
          throw new Error("CONFIG_CHANGED: refuse modified job configuration");
        const datasets = validated.datasets as Document;
        if (
          (datasets.train as Document).content_sha256 !== proposal.trainingDatasetSha256 ||
          (datasets.development as Document).content_sha256 !== proposal.developmentDatasetSha256
        )
          throw new Error("DATASET_MISMATCH");
        await pythonJson(this.python, ["-m", "forge_training", "run", "--config", job.configPath], {
          signal: abort.signal,
          timeoutMs: this.timeouts.runMs,
        });
      }
      const evidence = await this.evidence(job);
      clearInterval(timer);
      await inflight;
      if (heartbeatFailure) throw heartbeatFailure;
      await actors.worker.command(
        "ExperimentActor",
        message.experimentId,
        campaignId,
        "complete",
        {
          generation: lease.generation,
          result: {
            checkpointArtifactId: `checkpoint-${job.jobId}`,
            checkpointSha256: evidence.result.checkpoint_sha256,
            manifestSha256: evidence.manifestSha256,
            configSha256: job.configSha256,
            weightsChanged: true,
          },
        },
        `complete-${job.jobId}-${lease.generation}`,
      );
    } catch (error) {
      clearInterval(timer);
      await inflight;
      // Report only with the current fence. A lost fence is reconciled by the coordinator.
      await actors.worker
        .command("ExperimentActor", message.experimentId, campaignId, "reportFailure", {
          generation: lease.generation,
          reason: error instanceof Error ? error.message.slice(0, 900) : "Worker failed",
        })
        .catch(() => undefined);
      throw error;
    } finally {
      clearInterval(timer);
    }
  }
  /**
   * The evaluator reloads the checkpoint in its own process and must reproduce the worker's
   * development predictions exactly before recording an evaluation. This is reproduction on
   * the same host and code, not Phase 5 independent infrastructure.
   */
  async evaluate(message: WorkflowMessage): Promise<void> {
    if (message.kind !== "TRAINING_COMPLETED") throw new Error("Expected completed training");
    const job = this.job(message),
      evidence = await this.evidence(job);
    const checkpointSha256 = evidence.result.checkpoint_sha256;
    if (
      message.body.manifestSha256 !== evidence.manifestSha256 ||
      message.body.checkpointSha256 !== checkpointSha256
    )
      throw new Error("EVIDENCE_CHANGED");
    const reportPath = join(job.evaluatorDir, "candidate.json");
    if (!(await exists(reportPath))) {
      await mkdir(job.evaluatorDir, { recursive: true });
      await pythonJson(
        this.python,
        [
          "-m",
          "forge_training",
          "evaluate",
          "--config",
          job.configPath,
          "--checkpoint",
          join(String(job.config.output_dir), "checkpoint"),
          "--expected-hash",
          String(checkpointSha256),
          "--output",
          reportPath,
        ],
        { timeoutMs: this.timeouts.evaluationMs },
      );
    }
    const reproduced = await readJson(reportPath);
    if (
      reproduced.checkpoint_sha256 !== checkpointSha256 ||
      digest(reproduced.protocol) !== digest(evidence.candidate.protocol) ||
      digest(reproduced.dataset) !== digest(evidence.frozen.dataset) ||
      reproduced.num_correct !== evidence.candidate.num_correct ||
      digest(predictions(reproduced)) !== digest(predictions(evidence.candidate))
    )
      throw new Error("EVALUATION_NOT_REPRODUCED: evaluator and worker predictions differ");
    const { actors, campaignId } = this.dispatcher,
      reportSha256 = await fileHash(reportPath);
    await actors.evaluator.command(
      "ArtifactRegistryActor",
      campaignId,
      campaignId,
      "register",
      {
        artifactId: `evaluation-${job.jobId}`,
        experimentId: message.experimentId,
        kind: "evaluation",
        sha256: reportSha256,
        uri: pathToFileURL(reportPath).href,
        sizeBytes: (await readFile(reportPath)).length,
        provenanceSha256: evidence.manifestSha256,
      },
      `artifact-evaluation-${job.jobId}`,
    );
    await actors.evaluator.command(
      "ExperimentActor",
      message.experimentId,
      campaignId,
      "recordEvaluation",
      {
        reportArtifactId: `evaluation-${job.jobId}`,
        reportSha256,
        baselineReportSha256: job.baselineSha256,
        checkpointSha256,
        datasetSha256: (reproduced.dataset as Document).content_sha256,
        protocolSha256: digest(reproduced.protocol),
        evaluationRole: "development",
        numExamples: reproduced.num_examples,
        baselineCorrect: evidence.frozen.num_correct,
        candidateCorrect: reproduced.num_correct,
      },
      `evaluated-${job.jobId}`,
    );
    await this.dispatcher.publish(
      "evaluator",
      `evaluation-${job.jobId}`,
      message.experimentId,
      "EVALUATION_COMPLETED",
      {
        jobId: job.jobId,
        configSha256: job.configSha256,
        reportSha256,
        workerReportSha256: evidence.candidateSha256,
        checkpointSha256,
        numExamples: reproduced.num_examples,
        baselineCorrect: evidence.frozen.num_correct,
        candidateCorrect: reproduced.num_correct,
        reproducedWorkerPredictions: true,
        costStatus: "not_measured_by_local_worker",
        promotionAuthorized: false,
      },
    );
  }
  private async evidence(job: TrainingJob) {
    const runDir = String(job.config.output_dir);
    const manifestSha256 = await fileHash(join(runDir, "manifest.json"));
    await pythonJson(this.python, ["-m", "forge_training", "verify", "--run-dir", runDir]);
    if (
      manifestSha256 !== (await fileHash(join(runDir, "manifest.json"))) ||
      job.baselineSha256 !== (await fileHash(job.baselinePath))
    )
      throw new Error("EVIDENCE_CHANGED");
    const [result, baseline, candidate, resolved, frozen, manifest] = await Promise.all([
      readJson(join(runDir, "result.json")),
      readJson(join(runDir, "baseline.json")),
      readJson(join(runDir, "candidate.json")),
      readJson(join(runDir, "resolved-config.json")),
      readJson(job.baselinePath),
      readJson(join(runDir, "manifest.json")),
    ]);
    if (
      result.campaign_id !== job.config.campaign_id ||
      result.experiment_id !== job.config.experiment_id ||
      result.weights_changed !== true ||
      result.status !== "completed"
    )
      throw new Error("INVALID_TRAINING_EVIDENCE");
    // Worker stages dataset paths; all other resolved configuration must match the approved job.
    const { train: _train, development: _dev, ...actualConfig } = resolved;
    const { train: _expectedTrain, development: _expectedDev, ...expectedConfig } = job.config;
    if (digest(actualConfig) !== digest(expectedConfig)) throw new Error("CONFIG_MISMATCH");
    const trainingManifest = await readJson(join(runDir, "inputs/train.manifest.json"));
    if (trainingManifest.content_sha256 !== job.trainingDatasetSha256)
      throw new Error("TRAINING_DATASET_MISMATCH");
    if (
      digest(baseline.protocol) !== digest(frozen.protocol) ||
      digest(baseline.samples) !== digest(frozen.samples) ||
      digest(baseline.dataset) !== digest(frozen.dataset)
    )
      throw new Error("BASELINE_MISMATCH");
    let checkpointBytes = 0;
    for (const name of Object.keys(manifest.files as Document))
      if (name.startsWith("checkpoint/"))
        checkpointBytes += (await readFile(join(runDir, name))).length;
    return {
      result,
      frozen,
      candidate,
      candidateSha256: await fileHash(join(runDir, "candidate.json")),
      manifestSha256,
      checkpointBytes,
    };
  }
}
