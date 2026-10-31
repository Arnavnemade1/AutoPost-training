# Research agents and subagents

Forge's five roles are model-backed agents when an Azure OpenAI or OpenAI key is set
(`services/core/agents.py`). Without a key the campaign runs exactly as before, with the
evidence-driven local director.

| Role | When it reasons | What it produces | Authority |
| --- | --- | --- | --- |
| Research director | Before each experiment | The structured experiment proposal | Proposes; the API, budgets and governance gates decide |
| Data researcher | After the baseline | Failure patterns, counted, with question ids, sent to the director | Advises |
| Training engineer | After each training run | A reading of the loss curve (healthy, diverged, flat, overfit) | Advises |
| Experiment evaluator | After each evaluation | What the checkpoint fixed and broke, from the same measured answers | Explains; numbers stay measured |
| Governance council | After the deterministic review | An advisory promote or hold opinion with the risk to watch | Advisory; deterministic checks decide |

## Subagents

During any decision an agent may call `spawn_subagents` with a list of `{name, brief}`.
Each subagent is its own model call with its own brief and the same evidence. They run
in parallel, and their findings return to the parent before it answers. A subagent may
start its own helpers until the depth limit.

| Variable | Default | Meaning |
| --- | --- | --- |
| `FORGE_AGENT_MAX_SUBAGENTS` | 4 | Subagents per request; extra requests are dropped |
| `FORGE_AGENT_DEPTH` | 2 | Levels below the role agent; at the limit the spawn tool is not offered |
| `FORGE_AGENT_MAX_CALLS` | 12 | Model calls per decision, across the whole tree |

- The budget is held, not hoped for. Before an agent delegates, its own answer call and
  each subagent's first call are set aside, and requests that don't fit are trimmed. The
  spawn tool is offered only when there is room. Delegation can never leave an agent
  unable to answer.
- Agents are told to delegate when the evidence has many items (8 or more failures or
  examples) or several independent questions, and to answer directly otherwise. Measured on
  campaign forge-1d447446's 24 baseline failures, the data researcher split the work across
  3 or 4 subagents in 3 of 3 runs, those subagents split their slices again, and every
  decision finished within 12 calls.
- A failed subagent is reported to its parent as an error and does not stop the decision.
- A role whose model call fails records an error event, and the campaign continues
  without that role's opinion. The director still fails closed, as before.

## Instructions from Hephaestus

[Hephaestus](hephaestus.md) runs this team, and is a sixth participant in the research room. An instruction
it posts reaches the director's evidence as `operator_directives`, before the next experiment. It can't
change gates, budgets, the objective or sealed data. With no directive, the director's instructions and
evidence are unchanged.

## Where to see it

- **Agent chat:** a parent posts `SUBAGENTS_REPORTED` to the research room, and each
  subagent's finding is a thread reply under it.
- **Artifacts:** each decision writes `<experiment>-<role>-agents.json`, holding every
  model call, the response IDs, token usage and the subagent tree.
- **Campaign state:** `agent_calls` records each decision's role, model, calls, usage and
  subagent names.
- **Connections:** the Research agents card shows the provider.
- **API:** `/health` reports `services.director.agents` (the model per role) and
  `services.director.subagents` (the limits).

## Models and keys

- The key comes from `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_KEY` (Azure's
  OpenAI-compatible v1 endpoint), or from `OPENAI_API_KEY`.
- The model is chosen by `FORGE_AGENT_MODEL_<ROLE>`, then `FORGE_AGENT_MODEL`, then
  `FORGE_DIRECTOR_MODEL`.
- Final test data is never passed to any agent.
