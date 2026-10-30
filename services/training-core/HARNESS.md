# Phase 8 harness and release workflow

The harness evaluates baseline and candidate through **EleutherAI lm-evaluation-harness
0.4.9.2** using its GSM8K prompt, strict extraction, flexible extraction, and exact-match
metric. Both policies use the same frozen settings and examples, in separate processes.
The research worker's custom scorer remains available for historical comparisons.
Real agent collaboration is not implemented by this phase.

Install into a dedicated environment: `pip install -e '.[train,test,harness]'`. Keep the
existing worker environment, checkpoints, journals, and model cache. The harness never
cleans storage or evicts caches. Model evaluation is offline: provision the exact model
revision in the Hugging Face cache before running. No model weights are copied into
report bundles; only the small adapters are copied.

## Development first

```sh
forge-harness audit --run-dir /absolute/path/to/existing/run --output /new/audit-directory

forge-harness development \
  --config /absolute/path/to/experiment.json \
  --checkpoint /absolute/path/to/run/checkpoint \
  --expected-hash <adapter-directory-sha256> \
  --protocol examples/harness-qwen-development.json \
  --limits examples/harness-local-limits.json \
  --output /new/development-directory

forge-harness verify --bundle /new/development-directory --expected-hash <bundle-sha256>
```

`audit` re-scores preserved generations with the official task filters. It does **not**
generate new completions, change their prompts, or turn them into an established
benchmark run. It is useful for discovering scorer artifacts without loading a model.
`development` performs actual generation and independently reloads the candidate.
It accepts only validated development manifests whose source split is train or synthetic;
it checks question and ID separation against the run's training data.

The example protocol is **zero-shot with chat formatting and a 512-token completion cap**.
The default protocol is five-shot without chat formatting. These settings are visible,
immutable within a pair, and must match any subsequent release. When few-shot examples
are used, they come from the approved training partition; this is a declared variation
from a stock harness invocation sampling the entire official train split. Do not compare
these scores to a leaderboard without matching the complete protocol.

The report includes strict and flexible paired wins/losses, Wilson intervals, paired
bootstrap intervals, an exact one-sided McNemar test, examples whose strict gains were
already flexible-correct, and completion-cap diagnostics. Flexible extraction can select
an incidental number; it is not a new source of ground truth. Small development sets and
repeated selection make development results exploratory even when a p-value is small.
Only development reports emit suggested next experiments. They never copy evaluation
answers into training. A strict gain with a flexible-score decline blocks release.

## Resource behavior

Every generation job takes the existing host model-job lock, disables automatic batch
search, and uses batch size one. The parent samples its child process tree every 0.5 s,
checking resident memory, available system memory, swap growth, free disk, artifact size,
and time. MPS also has an allocator cap. The provided limits retain 2 GiB available memory
and 8 GiB disk, allow at most 0.5 GiB swap growth, and cap artifacts at 256 MiB. Sampling
can overshoot between checks and cannot attribute system-wide changes to a particular app.
The guard responds conservatively by stopping only its own child process group. It does
not kill unrelated processes, erase partial work, clear model caches, or retry a failed run.
Partial outputs and a failure record remain for diagnosis and never produce a comparison.

## Freeze and rehearse

```sh
forge-harness freeze --campaign /absolute/path/to/stopped/campaign \
  --harness-evidence /absolute/path/to/development-directory \
  --protocol examples/harness-qwen-development.json \
  --limits examples/harness-local-limits.json --output /new/frozen-release

forge-final rehearse --release /new/frozen-release --output /new/rehearsal
```

Freeze verifies the training bundle, promotion, governance evidence, reviewed development
report, held-out regression pair, adapter identity, and a development harness comparison
under the release protocol. Real-model releases require a strict gain without a flexible
accuracy drop. Fixtures may rehearse a non-improving release and are forbidden final data.

The release includes the adapter, any starting adapter, review evidence, frozen protocol,
research question hashes for overlap detection, file manifest, and reproduction notes.
Rehearsal uses only development data and cannot support a final claim. Existing output
directories are refused. Retain the returned bundle hash independently; a local manifest
alone is not a signature or proof of trustworthy approval.

## Separately owned final evaluator

Run these commands under an evaluator account/container that research processes cannot
access. It must have the matching source/runtime and the pinned model cached. Only that
principal provisions `openai/gsm8k` revision
`740312add88f781978c0658806c59bc2815b9866`, file
`main/test-00000-of-00001.parquet`, into its local cache. Research commands never request it.

```sh
forge-final init-authority --authority /private/evaluator/authority
forge-final authorize --authority /private/evaluator/authority --release /frozen/release
forge-final evaluate --authority /private/evaluator/authority \
  --grant /private/evaluator/authority/<issued>.grant.json \
  --release /frozen/release --output /private/evaluator/new-final-output
```

The private authority signs the release hash and durably authorizes one release per
campaign. An atomic SQLite transition consumes that grant **before any final rows are
read**. Concurrent evaluators, replay, changed releases, and reauthorization are refused.
Failure, timeout, or a killed process does not restore the grant. Preserve the registry:
creating another authority is an operator action outside this anti-replay boundary.

Final evaluation requires all 1,319 test examples, rejects overlaps with exposed research
questions, and does not allow a limit, new candidate, or protocol override. It evaluates
baseline and candidate once each. A supported improvement requires a positive strict delta,
a positive lower paired-bootstrap bound, exact one-sided p < .05, and no flexible-score
decline. This establishes neither general superiority nor absence of pretraining contamination.

**Same-UID local mode is not adversarial isolation.** Permissions and HMAC protect the
operator-owned workflow when ownership is actually separated. They cannot stop the owner
from editing code, minting another authority, or accessing already downloaded data. Do not
claim independent final evaluation until the separate execution boundary is deployed.

The orchestrator drives these commands for a campaign (`research.ts --finalize`, then
`scripts/final-evaluate.ts` for the evaluator) and binds the release and final result in
its `FinalEvaluationActor`; see the [orchestrator README](../orchestrator/README.md).

An independently executed full final run, reproduction on a different machine, a
matching two-minute demo recording, and event-rule acceptance remain required before final
readiness. Clean-copy reproduction of a fixture rehearsal is verified.
