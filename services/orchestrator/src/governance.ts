import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Document } from "../../../packages/terse-actors/src/contracts.js";
import { canonical, digest } from "../../../packages/terse-actors/src/core.js";
import type { PolicyLimits, Recipe } from "./director.js";
import { verifyRecipe, type SourcePartition } from "./recipes.js";
import type { RelayDispatcher } from "./relay.js";
import { exists, fileHash, pythonJson, readJson, type TrainingJob } from "./worker.js";

/** Held-out development-role data that no recipe may train on. */
export interface RegressionSuite {
  records: string;
  manifest: string;
  /** Allowed accuracy drop versus the untrained model, in basis points of examples. */
  maxDropBps: number;
  /** Development examples the baseline answered that the candidate may get wrong. */
  maxDevRegressions: number;
}
export interface GovernancePolicy {
  objectiveSha256: string;
  policyVersion: string;
  regression: RegressionSuite;
  limits: PolicyLimits;
  source: SourcePartition;
  template: Document;
}
export interface GovernanceOutcome {
  decision: "approved" | "rejected";
  reasonCodes: string[];
  evidenceSha256: string;
  evidencePath: string;
}

/**
 * Reviewer: re-derives every promotion-relevant fact from bytes on disk and authoritative
 * actor records, runs the regression suite, preserves the evidence, then records a
 * terminal decision. It never trusts worker or evaluator messages for any of these.
 */
export class GovernanceReviewer {
  private baselineRegression: Document | null = null;
  constructor(
    readonly python: string,
    readonly dispatcher: RelayDispatcher,
    readonly policy: GovernancePolicy,
    readonly directory: string,
    readonly timeoutMs: number,
  ) {}

  async review(job: TrainingJob, experimentId: string, recipe: Recipe): Promise<GovernanceOutcome> {
    const { actors, campaignId } = this.dispatcher;
    const reviewer = actors.reviewer;
    const campaign = (await reviewer.read("ResearchCampaignActor", campaignId, "getSnapshot"))!;
    const spec = campaign.spec as Document,
      baseline = spec.baseline as Document;
    const experiment = (await reviewer.read("ExperimentActor", experimentId, "getSnapshot"))!;
    const training = experiment.training as Document,
      evaluation = experiment.evaluation as Document;
    const [checkpoint, report] = await Promise.all(
      [training.checkpointArtifactId, evaluation.reportArtifactId].map((artifactId) =>
        reviewer.read("ArtifactRegistryActor", campaignId, "getArtifact", [artifactId]),
      ),
    );
    const runDir = String(job.config.output_dir);
    const reasons = new Set<string>();
    const facts: Document = {};

    // Artifact identity: recompute hashes from the files, not from any record.
    let checksumVerified = true;
    try {
      await pythonJson(this.python, ["-m", "forge_training", "verify", "--run-dir", runDir]);
    } catch (error) {
      checksumVerified = false;
      facts.runVerification = String(error instanceof Error ? error.message : error).slice(0, 500);
    }
    const checkpointPath = fileURLToPath(String(checkpoint?.uri));
    const recomputed = await pythonJson(this.python, [
      "-c",
      "import sys,json; from pathlib import Path; from forge_training.artifacts import directory_sha256; print(json.dumps({'sha256': directory_sha256(Path(sys.argv[1]))}))",
      checkpointPath,
    ]);
    const reportPath = fileURLToPath(String(report?.uri));
    const reportSha256 = await fileHash(reportPath);
    facts.checkpoint = {
      recordedByExperiment: training.checkpointSha256,
      recordedByRegistry: checkpoint?.sha256 ?? null,
      recomputed: recomputed.sha256,
    };
    facts.evaluationReport = {
      recordedByExperiment: evaluation.reportSha256,
      recordedByRegistry: report?.sha256 ?? null,
      recomputed: reportSha256,
    };
    if (
      !checksumVerified ||
      recomputed.sha256 !== training.checkpointSha256 ||
      checkpoint?.sha256 !== training.checkpointSha256 ||
      reportSha256 !== evaluation.reportSha256 ||
      report?.sha256 !== evaluation.reportSha256
    ) {
      checksumVerified = false;
      reasons.add("ARTIFACT_IDENTITY");
    }

    // Data access: the bytes the run actually trained on must be the ledger recipe's
    // selection from the allowed partition; development data must be the frozen set.
    const validated = await pythonJson(this.python, [
      "-m",
      "forge_training",
      "validate",
      "--config",
      job.configPath,
    ]).catch(() => null);
    const dataProblems = validated
      ? await verifyRecipe({
          recipe,
          limits: this.policy.limits,
          source: this.policy.source,
          template: this.policy.template,
          validatedConfig: validated.config as Document,
          trainingRecordsPath: join(runDir, "inputs/train.jsonl"),
        })
      : ["staged run configuration does not validate"];
    const developmentSha256 = (
      ((validated?.datasets as Document | undefined)?.development as Document | undefined) ?? {}
    ).content_sha256;
    if (developmentSha256 !== baseline.datasetSha256)
      dataProblems.push("development data differs from the frozen baseline");
    facts.dataProblems = dataProblems;
    const dataAllowed = !dataProblems.length;
    if (!dataAllowed) reasons.add("DATA_NOT_ALLOWED");

    // Evaluation protocol: identical to the frozen baseline in every bound field.
    const reproduced = await readJson(reportPath);
    const evaluationReproducible =
      digest(reproduced.protocol) === baseline.protocolSha256 &&
      (reproduced.dataset as Document).content_sha256 === baseline.datasetSha256 &&
      reproduced.num_examples === baseline.numExamples &&
      evaluation.baselineCorrect === baseline.numCorrect &&
      reproduced.num_correct === evaluation.candidateCorrect &&
      reproduced.checkpoint_sha256 === training.checkpointSha256;
    if (!evaluationReproducible) reasons.add("EVALUATION_PROTOCOL");

    const proposal = experiment.proposal as Document;
    const objectiveAligned =
      digest(proposal.model) === digest(spec.model) &&
      (spec.allowedStrategies as string[]).includes(String(proposal.strategy)) &&
      evaluation.evaluationRole === "development";
    if (!objectiveAligned) reasons.add("OBJECTIVE_MISMATCH");

    // Regressions: paired development examples and a held-out suite. Only run the
    // suite on intact artifacts; a tampered checkpoint is not evaluated further.
    const frozen = await readJson(job.baselinePath);
    const correctBefore = new Set(
      (frozen.samples as Document[]).filter((s) => s.correct === true).map((s) => s.id),
    );
    const devRegressions = (reproduced.samples as Document[]).filter(
      (s) => correctBefore.has(s.id) && s.correct !== true,
    ).length;
    let regressionsPassed = devRegressions <= this.policy.regression.maxDevRegressions;
    facts.developmentRegressions = devRegressions;
    if (checksumVerified && dataAllowed) {
      const suite = await this.regression(job, String(training.checkpointSha256), checkpointPath);
      const allowed = Math.floor(
        (Number(suite.baseline.num_examples) * this.policy.regression.maxDropBps) / 10_000,
      );
      facts.regressionSuite = {
        numExamples: suite.baseline.num_examples,
        baselineCorrect: suite.baseline.num_correct,
        candidateCorrect: suite.candidate.num_correct,
        allowedDrop: allowed,
        candidateReportSha256: suite.candidateSha256,
      };
      if (Number(suite.candidate.num_correct) < Number(suite.baseline.num_correct) - allowed)
        regressionsPassed = false;
    } else {
      regressionsPassed = false;
      facts.regressionSuite = "not run: artifact identity or data checks failed";
    }
    if (!regressionsPassed) reasons.add("REGRESSION");

    const checks = {
      checksumVerified,
      objectiveAligned,
      evaluationReproducible,
      regressionsPassed,
      dataAllowed,
    };
    const decision = reasons.size ? "rejected" : "approved";
    const evidencePath = join(this.directory, `${experimentId}.json`);
    const bundle = canonical({ experimentId, decision, reasonCodes: [...reasons], checks, facts });
    await mkdir(this.directory, { recursive: true });
    // Evidence is preserved before the decision; a retry must reproduce the same bundle.
    if (!(await exists(evidencePath))) await writeFile(evidencePath, bundle, { flag: "wx" });
    else if ((await readFile(evidencePath, "utf8")) !== bundle)
      throw new Error(
        "GOVERNANCE_EVIDENCE_CONFLICT: a different review exists for this experiment",
      );
    const evidenceSha256 = await fileHash(evidencePath);
    await reviewer.command(
      "GovernanceActor",
      campaignId,
      campaignId,
      "recordDecision",
      {
        experimentId,
        checkpointSha256: training.checkpointSha256,
        evaluationReportSha256: evaluation.reportSha256,
        objectiveSha256: this.policy.objectiveSha256,
        policyVersion: this.policy.policyVersion,
        decision,
        reasonCodes: [...reasons],
        evidenceRefs: [evidenceSha256, String(evaluation.reportSha256)],
        checks,
      },
      `governance-${experimentId}`,
    );
    return { decision, reasonCodes: [...reasons], evidenceSha256, evidencePath };
  }

  /** Untrained and candidate scores on the held-out suite, under the frozen protocol. */
  private async regression(job: TrainingJob, checkpointSha256: string, checkpointPath: string) {
    const { records, manifest } = this.policy.regression;
    const config = { ...job.config, development: { records, manifest } };
    const configPath = join(this.directory, `${job.jobId}-regression-config.json`);
    await mkdir(this.directory, { recursive: true });
    if (!(await exists(configPath)))
      await writeFile(configPath, JSON.stringify(config), { flag: "wx" });
    const evaluate = async (name: string, checkpoint: string[]) => {
      const output = join(this.directory, name);
      if (!(await exists(output)))
        await pythonJson(
          this.python,
          [
            "-m",
            "forge_training",
            "evaluate",
            "--config",
            configPath,
            ...checkpoint,
            "--output",
            output,
          ],
          { timeoutMs: this.timeoutMs },
        );
      return output;
    };
    if (!this.baselineRegression)
      this.baselineRegression = await readJson(await evaluate("regression-baseline.json", []));
    const candidatePath = await evaluate(`${job.jobId}-regression.json`, [
      "--checkpoint",
      checkpointPath,
      "--expected-hash",
      checkpointSha256,
    ]);
    return {
      baseline: this.baselineRegression,
      candidate: await readJson(candidatePath),
      candidateSha256: await fileHash(candidatePath),
    };
  }
}
