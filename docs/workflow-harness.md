# Durable workflow harness

The workflow harness runs research tools as a dependency graph across local processes
and SuperServe sandboxes. It keeps the execution journal on the host, freezes the
manifest and input hashes, verifies artifact handoffs, and resumes completed work
without repeating it. It complements the pinned `forge-harness` benchmark evaluator;
neither its scoring protocol nor its sealed-data gates are replaced.

The design draws on separating durable sessions from disposable execution environments
in [Managed Agents](https://www.anthropic.com/research/managed-agents), and structured
handoffs with independent evaluation in
[long-running harness design](https://www.anthropic.com/research/harness-design-long-running-apps).
SuperServe integration follows the
[Python SDK](https://github.com/superserve-ai/superserve/tree/main/packages/python-sdk)
and pins `superserve==0.11.5`.

## Start locally

From the repository root, using the project's Python environment:

```sh
npm run harness -- doctor
npm run harness -- validate examples/harness/local.json
npm run harness -- run examples/harness/local.json --output artifacts/workflow-demo
npm run harness -- status artifacts/workflow-demo
npm run harness -- verify artifacts/workflow-demo
npm run harness -- resume artifacts/workflow-demo
npm run harness -- events artifacts/workflow-demo
```

The example produces fixture metrics and checks them in a separate task. Its numbers
are synthetic and make no model-improvement claim. `python -m services.harness` exposes
the same CLI without npm. Reusing a run directory requires `resume`; changing the
manifest, source root, harness source, Python runtime or input bytes requires a new run directory.

## Features

| Capability | Behavior |
| --- | --- |
| Dependency scheduling | Validates unknown dependencies, duplicate IDs and cycles before execution; blocks descendants of failed tasks |
| Concurrency | `max_parallel` bounds simultaneous tasks; shared `resources` names serialize access within one workflow |
| Mixed execution | Each task selects `local` or `superserve`; dependency artifacts cross provider boundaries through verified host files |
| Recovery | Atomic, flushed state writes and a process lock prevent partial snapshots and competing schedulers |
| Completed-work reuse | Verifies declared output coverage, byte sizes and SHA-256 checksums before resuming |
| Quality gates | Predeclared comparisons against JSON output fields must pass before dependent tasks run |
| Retries | Explicit `retry_safe`, bounded `attempts`, exponential delay, separate attempt workspaces |
| Budgets | Workflow deadline persists across restarts; per-task timeout, log cap and artifact-transfer cap |
| Cancellation | SIGINT/SIGTERM or `cancel` stops scheduling and terminates active execution |
| Observability | JSON lifecycle events, linked journal hashes, exit codes, attempt history and bounded stdout/stderr files |
| Credentials | Standalone tasks inherit only explicitly named environment variables, plus a minimal local process environment |
| SuperServe lifecycle | Private previews, template/snapshot origin, optional success snapshot, explicit deletion and recorded cleanup failures |

## Write a workflow

```json
{
  "version": 1,
  "name": "research-tools",
  "max_parallel": 2,
  "max_seconds": 1800,
  "fail_fast": false,
  "tasks": [
    {
      "id": "analyze",
      "command": ["{python}", "analyze.py", "input.json"],
      "inputs": [
        {"path": "analyze.py", "source": "tools/analyze.py"},
        {"path": "input.json", "source": "data/permitted-input.json"}
      ],
      "outputs": ["analysis.json"],
      "resources": ["model"],
      "timeout_seconds": 600,
      "max_output_bytes": 16777216,
      "max_artifact_bytes": 268435456,
      "retry_safe": true,
      "attempts": 2,
      "retry_delay_seconds": 2
    },
    {
      "id": "review",
      "needs": ["analyze"],
      "command": ["{python}", "review.py", "analysis.json"],
      "inputs": [
        {"path": "review.py", "source": "tools/review.py"},
        {"path": "analysis.json", "task": "analyze", "source": "analysis.json"}
      ],
      "outputs": ["review.json"]
    }
  ]
}
```

Supply the tool scripts and permitted data under `--root` (the current directory by
default). Commands are argument arrays. `{python}` selects the local interpreter or
`python3` inside SuperServe. Shell syntax is interpreted only if explicitly invoking
a shell. Every attempt starts in its own workspace. Paths must be relative and cannot
traverse directories; `.forge` is reserved for supervisor files. Local artifact
symlinks are rejected. Outputs must be individual files, not directories. Archive a
checkpoint explicitly if a task must transfer it as one file.

The task's `env` list contains names such as `HF_TOKEN`, resolved from the scheduler's
environment at execution. Missing variables fail preflight. Do not put credentials in
command arguments, manifests, input files, or printed output. Logs are retained as task
evidence and are not automatically scrubbed. Provider error messages are not copied
into the journal; their exception types are recorded instead.

For a quality gate, add `checks` to a task, for example
`{"artifact":"analysis.json","pointer":"/accuracy","operator":"ge","value":0.7}`.
The referenced artifact must be a declared output. JSON pointers select scalar values;
`eq`, `ne`, `ge`, `le`, `gt` and `lt` compare them to predeclared thresholds. Missing
fields, invalid values and failed checks fail the task even when the command exits
successfully. Ordered comparisons require finite numbers and do not coerce booleans.

## SuperServe

```sh
uv sync --extra superserve
export SUPERSERVE_API_KEY='<your API key>'
npm run harness -- doctor
npm run harness -- run examples/harness/superserve.json --output artifacts/superserve-probe
```

The probe provisions a sandbox and uses paid infrastructure when your account charges
for it. It reports Linux/Python information, transfers the output, and checks it on the
host. No remote provisioning occurs during `validate` or `doctor`.

The sandbox image must include Python 3 and the dependencies required by the command.
Set `sandbox.template` to your prepared template, or `sandbox.snapshot` to an existing
snapshot ID. The SDK's default template is used when neither is supplied. Forge does
not install dependencies or upload the entire repository implicitly. The SDK reads its
control-plane credentials on the host; they are not passed to task commands unless
explicitly listed in `env`. A restored template/snapshot may have its own environment.

Each attempt owns a fresh sandbox. The bounded supervisor, inputs and command are
uploaded; declared outputs and bounded logs return before the sandbox is deleted.
`sandbox.snapshot_on_success` optionally retains a `mem+fs` snapshot and records its
ID. Snapshots persist separately from the deleted sandbox and must be managed in your
SuperServe account. `sandbox.auto_delete_seconds` provides a cleanup fallback after
auto-pause, not a replacement for explicit deletion. Cancellation also requests deletion.
Cleanup failure marks the attempt failed, suppresses automatic retries, and records the
sandbox ID. Resume retries deletion before proceeding. A control-plane outage can delay
cleanup beyond the task deadline; investigate any `cleanup: required` record.

SuperServe is an agent sandbox provider, not an assumed GPU provider. Existing model
compute continues to use `FORGE_BACKEND=local` or `modal`. This adapter does not add
SuperServe as a GPU training backend. Desktop, previews, networking and team-secret
management remain SDK capabilities rather than workflow actions.

## Existing campaigns

```sh
FORGE_WORKER_HARNESS=durable npm run lab
```

New command-center campaigns then run the existing campaign worker under the durable
supervisor. Their workflow record lives at `artifacts/<campaign-id>/workflow/state.json`.
The worker still performs SFT/GRPO, production-failure analysis, actor transitions,
Relay handoffs, governance and final evaluation through the existing code paths. Modal
remains selectable using `FORGE_BACKEND=modal`, with its existing strategy restrictions.
The campaign adapter explicitly passes the launch environment by variable name to
preserve provider configuration. The original worker remains the default; select it
explicitly with `FORGE_WORKER_HARNESS=classic`.

A campaign is one non-retryable task. The workflow harness cannot safely resume the
campaign's internal research loop after a crash, and does not automatically restart
training or repeat sealed evaluations. Its durable record is additional execution
evidence, not a replacement for Terse authority or the campaign artifact registry.

## Recovery and limits

```sh
npm run harness -- cancel artifacts/workflow-demo
npm run harness -- resume artifacts/interrupted-run
npm run harness -- resume artifacts/interrupted-run --retry-interrupted
```

An interrupted task becomes `uncertain`; it is never automatically treated as successful.
Explicit recovery permits another attempt only when `retry_safe` was predeclared and
the attempt budget remains. For local work it also waits for the prior worker's recorded
deadline plus termination grace, avoiding overlap with an orphan supervisor. The local
supervisor enforces its own deadline independently of the scheduler. Workflows never
reset their overall deadline. A cancellation marker remains terminal; create a new run
to intentionally rerun cancelled work. Descendants of recovered tasks become eligible
again; descendants of permanently failed tasks remain blocked.

The local provider is for trusted commands and is not a security sandbox: commands have
the current user's filesystem privileges. Task resource names coordinate one workflow,
not different runs or hosts. Memory, CPU and disk quotas beyond retained logs and declared
artifact sizes belong to the execution environment. Log size polling can briefly overshoot
the limit; retained logs are truncated. Use a suitably bounded sandbox template for
stronger resource isolation. Secrets, installed libraries and undeclared host state are
not frozen by the workflow hash. The linked journal detects accidental changes, but is
not an authenticated ledger against an attacker who can rewrite the whole run directory.

Tests cover real local processes, dependency handoffs, integrity failures, retries,
cancellation, concurrency, resource serialization, recovery and SuperServe SDK-shaped
contract doubles. A successful contract test does not establish live account access.
Run the explicit SuperServe probe to validate your credentials, template and network.
