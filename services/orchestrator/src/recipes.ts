import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { Document } from "../../../packages/terse-actors/src/contracts.js";
import type { DataSelection, PolicyLimits, Recipe } from "./director.js";

/** The campaign's allowed training partition; recipes may only select from it. */
export interface SourcePartition {
  records: string;
  manifest: string;
}
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
function lines(text: string): string[] {
  if (!text.endsWith("\n")) throw new Error("Dataset records must end with a newline");
  return text.slice(0, -1).split("\n");
}

/**
 * Deterministic selection over exact source lines, preserving source order. `concise`
 * keeps the shorter half of solutions by character length (ties keep source order).
 */
export function selectRecords(source: string, data: DataSelection): string {
  const rows = lines(source);
  if (data === "full") return source;
  const keep = new Set(
    rows
      .map((line, index) => ({ index, length: String(JSON.parse(line).answer).length }))
      .sort((a, b) => a.length - b.length || a.index - b.index)
      .slice(0, Math.ceil(rows.length / 2))
      .map((row) => row.index),
  );
  return rows.filter((_, index) => keep.has(index)).join("\n") + "\n";
}

export function withinLimits(recipe: Recipe, limits: PolicyLimits): boolean {
  return (
    Number.isInteger(recipe.maxSteps) &&
    recipe.maxSteps >= 1 &&
    recipe.maxSteps <= limits.maxSteps &&
    recipe.learningRate >= limits.minLearningRate &&
    recipe.learningRate <= limits.maxLearningRate
  );
}

/**
 * Data role: write the recipe's training subset, its manifest and an experiment config.
 * Everything except the recipe's fields comes from the campaign template.
 */
export async function materialize(options: {
  directory: string;
  template: Document;
  templatePath: string;
  source: SourcePartition;
  campaignId: string;
  experimentId: string;
  recipe: Recipe;
}): Promise<string> {
  const { directory, template, source, recipe } = options;
  const data = join(directory, "data");
  await mkdir(data, { recursive: true });
  const records = selectRecords(await readFile(source.records, "utf8"), recipe.data);
  const sourceManifest = JSON.parse(await readFile(source.manifest, "utf8")) as Document;
  await writeFile(join(data, "train.jsonl"), records, { flag: "wx" });
  await writeFile(
    join(data, "train.manifest.json"),
    JSON.stringify({
      ...sourceManifest,
      dataset_id: `${sourceManifest.dataset_id}-${recipe.data}`,
      content_sha256: sha256(records),
      num_examples: lines(records).length,
    }),
    { flag: "wx" },
  );
  // Template paths are relative to the template; rebase them onto the experiment directory.
  const rebase = (path: string) => relative(directory, join(dirname(options.templatePath), path));
  const development = template.development as Document;
  const model = template.model as Document;
  const config = {
    ...template,
    campaign_id: options.campaignId,
    experiment_id: options.experimentId,
    model:
      model.source === "local" ? { ...model, model_id: rebase(String(model.model_id)) } : model,
    train: { records: "data/train.jsonl", manifest: "data/train.manifest.json" },
    development: {
      records: rebase(String(development.records)),
      manifest: rebase(String(development.manifest)),
    },
    training: {
      ...(template.training as Document),
      learning_rate: recipe.learningRate,
      max_steps: recipe.maxSteps,
    },
    output_dir: "run",
  };
  const path = join(directory, "experiment.json");
  await writeFile(path, JSON.stringify(config, null, 2), { flag: "wx" });
  return path;
}

/** Every value the template sets must match; defaults the template omits are not pinned. */
function pins(expected: unknown, actual: unknown): boolean {
  if (expected && typeof expected === "object" && !Array.isArray(expected))
    return Object.entries(expected).every(([key, value]) =>
      pins(value, (actual as Record<string, unknown> | null)?.[key]),
    );
  return JSON.stringify(expected) === JSON.stringify(actual);
}

/**
 * Reviewer: recompute the recipe from the ledger launch record, independently of the data
 * role, and compare it with the validated configuration and the exact training bytes.
 */
export async function verifyRecipe(options: {
  recipe: Recipe;
  limits: PolicyLimits;
  source: SourcePartition;
  template: Document;
  validatedConfig: Document;
  trainingRecordsPath: string;
}): Promise<string[]> {
  const problems: string[] = [];
  const { recipe, validatedConfig } = options;
  if (!withinLimits(recipe, options.limits)) problems.push("recipe outside policy limits");
  const expected = selectRecords(await readFile(options.source.records, "utf8"), recipe.data);
  if ((await readFile(options.trainingRecordsPath, "utf8")) !== expected)
    problems.push("training records are not the recipe's selection from the allowed partition");
  const training = validatedConfig.training as Document;
  const { learning_rate: _lr, max_steps: _steps, ...fixed } = options.template.training as Document;
  if (!pins(fixed, training)) problems.push("training settings differ from the campaign template");
  if (training.learning_rate !== recipe.learningRate) problems.push("learning rate differs");
  if (training.max_steps !== recipe.maxSteps) problems.push("step count differs");
  for (const key of ["evaluation", "seed", "device", "precision", "max_model_parameters"])
    if (key in options.template && !pins(options.template[key], validatedConfig[key]))
      problems.push(`${key} differs from the frozen campaign protocol`);
  return problems;
}
