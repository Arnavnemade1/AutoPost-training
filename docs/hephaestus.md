# Hephaestus

Hephaestus is a bot in an iMessage group chat. Ask it to train something, and it starts Forge's
[research agents](agents.md), which propose and run the experiments and spin up subagents as needed.
It reports the measured result back to the chat.

```
group chat ──"@hephaestus start gsm8k"──▶ Hephaestus ──lab API──▶ campaign
                                              ▲                      │
   "finished. No improvement..." ◀────────────┘    research agents, subagents, budgets, governance
```

It commands the agents through the lab's own API, on this Mac. Every budget, provenance and governance
check the command center has applies, and it opens no port.

## Talking to it

Start a message with `@hephaestus` or `hephaestus`. Everything else in the chat is ignored.

| Say | What happens | Who |
| --- | --- | --- |
| `status` | What's running, and free memory | Anyone in the chat |
| `tasks` | Tasks that can be trained | Anyone in the chat |
| `campaigns` | Recent campaigns and their results | Anyone in the chat |
| `report <id>` | Measured results of one campaign | Anyone in the chat |
| `start <task> [what to improve]` | Starts the research agents | Operators |
| `stop <id>` | Stops a campaign it started | Operators |
| `azure [name]` | Posts the request for a friend's Azure model | Operators |

These commands cost nothing and work without a model. Anything else, such as "train the maths task on
word problems", goes to the connected model, which uses the same tools under the same rules.

When a campaign it started ends, it reports the result. It says "validated" only when the 95% interval
is above zero, and says so plainly when a run kept the original model.

## Setup

1. **Find the group chat.** macOS may ask to let this app control Messages.
   ```sh
   .venv/bin/python -m services.core.hephaestus chats
   ```
2. **Set it in `.env`:**
   ```sh
   FORGE_HEPHAESTUS_CHAT=<the id from step 1>
   FORGE_HEPHAESTUS_OPERATORS=+15551234567,friend@example.com
   ```
   The Mac's own Apple ID is always an operator. Everyone else in the chat can only look.
3. **Grant Full Disk Access** to the app that runs Hephaestus, such as Terminal, in System Settings →
   Privacy & Security. Reading the Messages database requires it. This gives that app access to all of
   your files, not only Messages, so a dedicated user account on the Mac is worth considering.
4. **Run the lab, then Hephaestus:**
   ```sh
   npm run lab
   npm run hephaestus
   ```

The Mac must stay awake and signed in to Messages. It starts from the newest message, so nothing said
before it joined is acted on.

**Its name in the chat.** Messages go out through the Mac's Apple ID, so the group sees them as coming
from that person, and each starts with `⚒️ Hephaestus`. To appear as its own participant, sign the Mac
(or a dedicated user account on it) in to a separate Apple ID, and add that to the group.

## Who can do what

A group chat is untrusted input, and a model can be talked into things. So authority is enforced in
code (`services/core/hephaestus/tools.py`), not by the model:

- **Role:** comes from the sender identity Messages recorded. Nothing said in a message changes it.
- **Tools:** a tool the asker's role doesn't allow isn't offered to the model, and is refused if called.
- **Scope:** it reads only the configured chat, and stores no message text.
- **Limits:** no message can raise these.

| Variable | Default | Meaning |
| --- | --- | --- |
| `FORGE_HEPHAESTUS_DAILY_CAMPAIGNS` | 3 | Campaigns it may start per day |
| `FORGE_HEPHAESTUS_DAILY_CALLS` | 200 | Its own model calls per day; the research agents have [their own limits](agents.md#subagents) |
| `FORGE_HEPHAESTUS_MAX_SECONDS` | 1800 | Time limit per campaign |
| `FORGE_HEPHAESTUS_MAX_EXPERIMENTS` | 2 | Experiments per campaign |
| `FORGE_HEPHAESTUS_MAX_TRAIN_STEPS` | 48 | Training steps per experiment |
| `FORGE_HEPHAESTUS_MIN_FREE_MEMORY` | 35 | Won't start below this free memory percentage (local training) |
| `FORGE_HEPHAESTUS_STOP_FREE_MEMORY` | 10 | Stops its campaign below this percentage (local training) |

From the chat it can run `broad_sft`, `targeted_sft` and `dpo`. GRPO stays in the command center because
of its memory use. It posts at most 30 messages an hour.

A campaign's final step runs its held-out test subset once, so starting campaigns from the chat uses
that subset as any other campaign does.

## Connecting a friend's Azure model

Hephaestus can have its own model connection, separate from the research agents'. That lets a friend's
account serve Hephaestus without seeing the agents' evidence, which includes training and evaluation
examples and can include failures from production traffic.

1. **Ask.** `azure Sam` in the chat, or from the terminal:
   ```sh
   .venv/bin/python -m services.core.hephaestus azure-request --to Sam
   ```
   Add `--send` to post it. It asks for the endpoint, the deployment name and a limited key, and tells
   them not to paste the key in the group.
2. **Add the values** to `.env`, once received privately:
   ```sh
   FORGE_HEPHAESTUS_AZURE_ENDPOINT=https://<resource>.openai.azure.com/openai/v1
   FORGE_HEPHAESTUS_AZURE_KEY=<key>
   FORGE_HEPHAESTUS_AZURE_MODEL=<deployment name>
   ```
3. **Check it** with one small call:
   ```sh
   .venv/bin/python -m services.core.hephaestus check-model
   ```

**What their account sees:** messages addressed to Hephaestus, and campaign names, scores and strategies.
It doesn't see the rest of the group's conversation, questions, answers or production traffic.

That holds only for this connection. Without these three values, Hephaestus shares the research agents'
connection. And if `AZURE_OPENAI_*` itself points at someone else's account, the research agents send it
their evidence, so check that you may share that data.

Model calls bill to their account, so agree a limit with them first. This connects the Mac to their model:
their own agents can't call Hephaestus, because it opens no port.

## Limits

- It depends on this Mac: it stops when the Mac sleeps or the lab stops, and catches up when it returns.
- macOS updates can change the Messages database or scripting. It reports what it can't read, rather
  than guessing.
- Everyone in the chat sees its posts, including scores and task names.
