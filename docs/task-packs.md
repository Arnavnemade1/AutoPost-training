# Task packs: bring your own data

A task pack is everything Forge needs to improve a model on one task: the data, the
instruction shown to the model, how an answer is checked, how data is split, a regression
suite, the labels the command center shows and which training methods apply. GSM8K math is
the built-in pack. A company adds its own by uploading a file in **New campaign → Add your
data**, or through the API.

The code is in `services/core/packs/` (packs and registration) and
`services/training-core/src/forge_training/checkers.py` and `tasks.py` (the reusable checker and
task contracts, usable without the lab).

## Supported tasks

| Kind | Rows | Checked by | Methods |
| --- | --- | --- | --- |
| Q&A with references | question, reference answer | numeric, exact or regex comparison of an extracted answer | Broad SFT, Targeted SFT, Teacher distillation |
| Structured extraction | input, reference JSON | JSON parsed from the reply, an optional JSON Schema and per-field comparisons | Broad SFT, Targeted SFT, Teacher distillation |
| Chat preferences | prompt, chosen reply, rejected reply | held-out preference accuracy ([preference alignment](preference-alignment.md)) | Broad SFT (on the chosen reply), DPO |

GRPO stays specific to the GSM8K pack, because its rewards come from the numeric Terse math
worlds.

## Checkers

A checker is an extractor plus a comparator, declared as data and identified by a content
hash (`checker_id`), so a checker cannot change without changing the pack's identity.

| Extractor | Reads |
| --- | --- |
| `final_marker` | the text after a final marker line such as `#### 42` or `Answer: Paris`; grammar `number` parses it as a number, `forge_numeric_v1` is the original GSM8K rule |
| `regex` | a capture group of a pattern |
| `last_line`, `whole` | the last non-empty line, or the whole reply |
| `json` | the first JSON object in the reply, including a fenced code block |

| Comparator | Correct when |
| --- | --- |
| `numeric` | equal numbers, with optional absolute or relative tolerance |
| `exact` | equal text after optional strip, casefold, whitespace and NFKC normalization |
| `regex_match` | the answer fully matches the reference pattern |
| `json_fields` | the reply satisfies the schema and each listed JSON-pointer field matches |
| `python` | an operator-supplied `check(output, reference)` returns true |

A Python checker is pinned by SHA-256, runs in a separate isolated interpreter with an empty
environment and a timeout, and can be registered from the command line only. It is operator
code, not a security boundary. Regex patterns are trusted operator input too: capping the text
they see bounds polynomial backtracking but cannot rescue an exponential pattern.

## Registration

Registration validates every row before anything is stored:

1. Columns are mapped with `{column}` templates for the question, the reference (or the chosen
   and rejected replies) and an optional id column.
2. Every reference must pass its own checker. A mapping mistake shows up here as invalid rows
   instead of as zero scores later.
3. Rows are deduplicated by normalized question.
4. Rows are ranked by a salted hash and cut at exact fractions: 20% sealed test, 15%
   development, the rest training by default. Membership is random; pool sizes are exact. At
   least 24 sealed and 12 development rows are required.
5. The operator states, in at least 20 characters, why the data may be used for training. This
   is recorded with the pack and shown in every report.

A registered pack is immutable: `data/packs/<name>-<hash>/` holds `spec.json`, the three pools
and the validation report. Registering identical content and settings again returns the same
pack. Previews show training rows only, never development or sealed rows.

The API is the same one the UI uses:

- `POST /packs/preview` and `POST /packs`, each with `{"draft": {...}, "text": "..."}` or
  `{"draft": {...}, "upload_id": "..."}`.
- Large files cross the 30-second local proxy as checksummed parts: `POST /uploads`, then
  `POST /uploads/{id}/parts` (at most 4 MB each), then `POST /uploads/{id}/complete` (256 MB
  in total).
- `GET /packs` and `GET /packs/{id}` list packs with their split counts and how many sealed
  rows no campaign has queried yet.

## How a campaign uses a pack

`CampaignConfig.task_pack` names the pack, and the API refuses methods the task does not
support. The runner takes training, development and sealed data from the pack, prompts with its
instruction and scores with its checker. Scoring always happens on the lab machine, so a Modal
job carries only the prompt. Each sealed row is queried by at most one campaign on that pack;
exposure is tracked across campaigns exactly as for GSM8K.

Governance pins the pack: new campaigns record `task_pack_sha256` and `policy_version:
forge-policy-v2`. A review whose evidence names a different pack hash is rejected with
`TASK_PACK_MODIFIED`. Policies recorded before task packs carry no pack hash and replay
unchanged.

Uploaded packs keep the four GSM8K arithmetic questions as a small general-skill retention check,
scored with the GSM8K checker. It is not a broad safety evaluation.

## GSM8K is unchanged

The GSM8K pack reproduces the original behavior byte for byte: the same splits for every seed,
the same prompt, the same scorer and evaluation fields, the same regression suite, reward
version and limitations. `tests/test_packs.py` checks this against a frozen copy of the
original loader and scorer.
