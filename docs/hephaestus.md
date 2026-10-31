# Hephaestus

Hephaestus runs Forge's research team for you, from a private conversation in Agent chat or from iMessage. Ask it to train something, and it starts Forge's
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

**In Agent chat:** open **Hephaestus** at the top of the list. It's just you and the bot, and you're its
admin. This works as soon as the lab is running.

**In iMessage:** start a message with `@hephaestus` or `hephaestus`. Everything else is ignored.

| Say | What happens | Who |
| --- | --- | --- |
| `status` | What's running, and free memory | Anyone in the chat |
| `tasks` | Tasks that can be trained | Anyone in the chat |
| `campaigns` | Recent campaigns and their results | Anyone in the chat |
| `report <id>` | Measured results of one campaign | Anyone in the chat |
| `start <task> [what to improve]` | Starts the research agents | Operators |
| `stop <id>` | Stops a campaign (operators: only ones it started) | Operators |
| `azure [name]` | Posts the request for a friend's Azure model | Operators |
| `tell <id> <instruction>` | Posts in the research room, for the director | Admin |
| `chat <id>` | Who the research agents have been messaging, and about what | Admin |

These commands cost nothing and work without a model. Anything else, such as "train the maths task on
word problems", goes to the connected model, which uses the same tools under the same rules.

When a campaign it started ends, it reports the result. It says "validated" only when the 95% interval
is above zero, and says so plainly when a run kept the original model.

## Admin of the agent chat

You, as the Mac's owner, are the admin. An admin's Hephaestus can read the research agents' conversations,
post in the research room and stop any campaign. It's a registered Agent Relay participant, so its posts
go through the same verified delivery and appear in the room under its own name.

An instruction from `tell` reaches the research director's evidence before its next experiment, and is
recorded in that experiment's `director_input` artifact. The director weighs it. The local director, used
when no model is connected, can't act on written instructions, and Hephaestus says so when you post one.
Each campaign takes up to 5 instructions.

**What admin doesn't include:** approving or promoting a checkpoint, overriding governance, raising a
budget, changing the objective, or touching sealed test data. No tool does these, for any role. Otherwise
one bad message could fake a training result.

## Setup in iMessage

1. **Choose where it listens:**
   - **Just you:** your message-yourself thread needs no second Apple ID. Its id is `any;-;` then your
     number or Apple ID email.
   - **A group:** list the ids. macOS may ask to let this app control Messages. Creating a group takes a
     person pressing Send, since macOS has no way to script it, and needs at least two other people.
     ```sh
     .venv/bin/python -m services.core.hephaestus chats
     ```
2. **Set it in `.env`:**
   ```sh
   FORGE_HEPHAESTUS_CHAT=<the chat id>
   # Your own number or email, so your message-yourself thread counts as you.
   FORGE_HEPHAESTUS_OWNER=+15551234567
   # Optional, for a group: people who may start training.
   FORGE_HEPHAESTUS_OPERATORS=+15550001111,friend@example.com
   ```
   Messages sent from this Mac's Apple ID, and from `FORGE_HEPHAESTUS_OWNER`, are admin. Everyone else can
   only look.
3. **Grant Full Disk Access to Terminal, and to nothing else.** Reading the Messages database needs it,
   and macOS only lets you grant it to a whole app. Open System Settings → Privacy & Security → Full
   Disk Access and turn on Terminal. Don't grant it to Claude, so an agent working in this repository
   still can't read your messages. Anything you run in Terminal gets the same access, so turn it off
   when you aren't running Hephaestus.

   Then, in Terminal, prove it works. This counts messages in the one chat, and reads no text:
   ```sh
   .venv/bin/python -m services.core.hephaestus check-access
   ```
4. **Run the lab, then Hephaestus:**
   ```sh
   npm run lab
   npm run hephaestus
   ```
   Run `npm run hephaestus` in Terminal, since that's the app with access. Press Ctrl+C to stop it.

The Mac must stay awake and signed in to Messages. It starts from the newest message, so nothing said
before it joined is acted on.

**Its name in iMessage.** Messages go out through the Mac's Apple ID, so the group sees them as coming
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

Limits are shared between Agent chat and iMessage. A campaign's final step runs its held-out test subset once, so starting campaigns from the chat uses
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
