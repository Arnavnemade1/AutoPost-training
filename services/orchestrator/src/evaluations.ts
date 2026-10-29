import { constants } from "node:fs";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Document } from "../../../packages/terse-actors/src/contracts.js";
import { digest } from "../../../packages/terse-actors/src/core.js";
import { exists, fileHash, pythonJson, readJson } from "./worker.js";

export interface UntrainedEvaluation {
  path: string;
  sha256: string;
  cached: boolean;
}

/**
 * An untrained-model evaluation depends only on its campaign and experiment labels, the
 * model, the development data and the evaluation protocol, which includes the training
 * core's source hash and runtime versions. Identical inputs give the same predictions, so
 * the report is computed once and reused by key. The cache trusts the local filesystem.
 */
export async function untrainedEvaluation(options: {
  python: string;
  configPath: string;
  output: string;
  cacheDir: string | null;
  timeoutMs: number;
}): Promise<UntrainedEvaluation> {
  const { python, configPath, output, cacheDir, timeoutMs } = options;
  const identity = await pythonJson(python, [
    "-m",
    "forge_training",
    "protocol",
    "--config",
    configPath,
  ]);
  const cached = cacheDir && join(cacheDir, `${digest({ kind: "untrained", ...identity })}.json`);
  if (cached && (await exists(cached))) {
    const report = await readJson(cached);
    if (
      report.checkpoint_sha256 !== null ||
      report.campaign_id !== identity.campaign_id ||
      report.experiment_id !== identity.experiment_id ||
      digest(report.model) !== digest(identity.model) ||
      digest(report.dataset) !== digest(identity.dataset) ||
      digest(report.protocol) !== digest(identity.protocol)
    )
      throw new Error("EVALUATION_CACHE_CONFLICT: cached report does not match its key");
    await copyFile(cached, output, constants.COPYFILE_EXCL);
    return { path: output, sha256: await fileHash(output), cached: true };
  }
  await pythonJson(
    python,
    ["-m", "forge_training", "evaluate", "--config", configPath, "--output", output],
    { timeoutMs },
  );
  if (cached) {
    await mkdir(dirname(cached), { recursive: true });
    const partial = `${cached}.${process.pid}.partial`;
    await copyFile(output, partial);
    await rename(partial, cached);
  }
  return { path: output, sha256: await fileHash(output), cached: false };
}

export interface BatchChoice {
  templatePath: string;
  baseline: UntrainedEvaluation;
  reference: UntrainedEvaluation | null;
  requested: number;
  used: number;
  identicalPredictions: number | null;
  numExamples: number;
}

/**
 * Batched greedy decoding can break near-ties differently from batch size 1. A campaign
 * adopts its requested batch size only if the untrained model's development predictions
 * are identical to batch size 1; otherwise it falls back to batch size 1. Baseline and
 * candidates always share one protocol, so the choice is made before any training.
 */
export async function chooseEvaluationBatch(options: {
  python: string;
  templatePath: string;
  directory: string;
  cacheDir: string | null;
  timeoutMs: number;
}): Promise<BatchChoice> {
  const { python, templatePath, directory, cacheDir, timeoutMs } = options;
  const template = await readJson(templatePath);
  const requested = Number((template.evaluation as Document | undefined)?.batch_size ?? 1);
  const evaluate = (configPath: string, name: string) =>
    untrainedEvaluation({ python, configPath, output: join(directory, name), cacheDir, timeoutMs });
  const baseline = await evaluate(templatePath, `frozen-baseline-batch${requested}.json`);
  const report = await readJson(baseline.path);
  const numExamples = Number(report.num_examples);
  if (requested === 1)
    return {
      templatePath,
      baseline,
      reference: null,
      requested,
      used: 1,
      identicalPredictions: null,
      numExamples,
    };
  // Same directory as the template, so its relative input paths resolve identically.
  const referencePath = join(dirname(templatePath), "template-batch1.json");
  await writeFile(
    referencePath,
    JSON.stringify({
      ...template,
      evaluation: { ...(template.evaluation as Document), batch_size: 1 },
    }),
  );
  const reference = await evaluate(referencePath, "frozen-baseline-batch1.json");
  const one = (await readJson(reference.path)).samples as Document[];
  const identical = (report.samples as Document[]).filter(
    (sample, i) =>
      sample.id === one[i]?.id &&
      sample.prediction === one[i].prediction &&
      sample.generated_tokens === one[i].generated_tokens,
  ).length;
  const adopt = identical === numExamples && one.length === numExamples;
  return {
    templatePath: adopt ? templatePath : referencePath,
    baseline: adopt ? baseline : reference,
    reference,
    requested,
    used: adopt ? requested : 1,
    identicalPredictions: identical,
    numExamples,
  };
}
