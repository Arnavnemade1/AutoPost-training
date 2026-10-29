# Agent Relay in Forge

Every handoff between Forge's research agents is an Agent Relay message, and work only
proceeds after the recipient has taken that message from its own Relay inbox, verified it
and acknowledged it. This page lists every capability of the installed SDK and engine,
whether Forge uses it, and where.

Versions: `@agent-relay/sdk` 14.0.0 (client `@relaycast/sdk` 8.16.0) against
`@relaycast/engine` 12.0.0, the same engine in the root app and in `services/orchestrator`.
Findings below come from the installed sources (`node_modules/@agent-relay/sdk/dist`,
`node_modules/@relaycast/engine/dist`) and from probes against a real local engine, not
from memory.

## Two paths, one transport

| Path | Code | Who uses it |
| --- | --- | --- |
| Command center campaign | `services/core/runner.py` -> `services/core/engine.py` `send`/`react` -> `services/relay/bridge.mjs` -> `services/relay/delivery.mjs` | `npm run lab`, every campaign launched from the UI |
| Orchestrator research | `services/orchestrator/src/relay.ts` `RelayDispatcher` | `npm test` / `npm run research` in `services/orchestrator` |

## Routes the campaign uses

| Handoff | From -> to | Relay route |
| --- | --- | --- |
| `PRODUCTION_FAILURES_TRIAGED` | data -> director | DM |
| `BASELINE_REQUESTED` / `BASELINE_COMPLETED` | director <-> evaluator | DM |
| `EXPERIMENT_PROPOSED` | director -> room | research-room post |
| `EXPERIMENT_APPROVED` | data -> trainer | DM |
| `TRAINING_ASSIGNED` | director -> trainer | DM |
| `TRAINING_COMPLETED` / `TRAINING_FAILED` | trainer -> evaluator / director | DM |
| `CHECKPOINT_SAVED` | trainer -> room | research-room post |
| `EVALUATION_COMPLETED` | evaluator -> director | DM |
| `CHECKPOINT_APPROVED` / `STRATEGY_REVISED` | governance -> director | DM |
| `CHECKPOINT_VERDICT` | governance, in the checkpoint's thread | thread reply, plus a reaction on the checkpoint post |
| `CAMPAIGN_COMPLETED` | director -> room | research-room post |

## Capability inventory

| Capability | API | Used by Forge | How |
| --- | --- | --- | --- |
| Workspaces | `AgentRelay.createWorkspace`, `new AgentRelay({ workspaceKey })` | Yes | Local: minted on first boot, key kept in `data/relay-credentials.json` (0600). Hosted: `FORGE_RELAY_WORKSPACE_KEY` from the environment, never written to disk (`services/relay/bridge.mjs:28`, `services/relay/config.mjs`) |
| Agent identities | `workspace.register`, `workspace.reconnect` | Yes | One identity per role; tokens reused across restarts (`bridge.mjs:39-44`, `orchestrator/src/relay.ts:24`) |
| Direct messages | `sendMessage({ to: "@role" })`, `messages.listDirect` | Yes | Every 1:1 handoff (`delivery.mjs:189`); a readback proves the DM conversation with `listDirect` (`delivery.mjs:228`); all orchestrator workflow messages (`relay.ts:90`) |
| Channels | `channels.create/join/members/get/list` | Yes | One research room per campaign, membership verified before use (`delivery.mjs:103-121`) |
| Channel posts | `sendMessage({ to: "#room" })` | Yes | Decisions and announcements (`delivery.mjs:206`) |
| Threads / replies | `reply`, `threads.get` | Yes | Governance verdict replies under the checkpoint post; parent must be in the room (`delivery.mjs:196-204`); `threads.get` asserted in `scripts/check-relay.mjs` |
| Reactions | `react`, `messages.reactions` | Yes | Governance reacts approve/reject on the checkpoint (`delivery.mjs:290`), shown as tapbacks in Agent chat |
| Durable inbox (delivery ledger) | `inbox.list`, `inbox.ack`, `inbox.fail` | Yes | Recipients drain their inbox, verify sender, route, exact text and the Forge envelope, then ack; bad copies are failed in Relay (`delivery.mjs:138-151`, `relay.ts:134-192`) |
| Read receipts | `messages.markRead`, `messages.readers` | Yes | Recipient marks read after ack; the sender's receipt lists who read it (`delivery.mjs:151`, `:247`); "Read by 4" / "Read 23:21" in the UI |
| Push / realtime | observer token (`observerTokens.create`) + `addListener` over `/v1/ws` | Yes | A read-only observer stream wakes recipients; receipts record `woke_by: push` (`bridge.mjs:55`, `:84`, `delivery.mjs` `pushWaiter`). Requires `startServer` (`services/relay/server.mjs`) |
| Idempotency keys | `idempotencyKey` | Yes | Retries after a lost response return the original message; a changed payload is a conflict (`delivery.mjs:193/203/210`, `relay.ts:93`) |
| Message metadata | `metadata` | Yes | The Forge envelope (id, campaign, sender, recipient, category, experiment) rides as metadata so text stays readable in any Relay client (`delivery.mjs` `envelope`) |
| Search | `messages.search` | Yes | Agent chat search box -> `GET /campaigns/{id}/relay/search` -> bridge (`delivery.mjs:318`) |
| Message read | `messages.get`, `messages.list` | Yes | Reconciliation by recorded Relay ID, final record check (`delivery.mjs:162/241`, `relay.ts:173`) |
| Workspace info | `workspace.info` | No | Nothing needs it beyond health |
| Mentions | `mentions` on send | No | The SDK prefixes `@name ` to the text, which breaks exact-byte verification; the recipient travels in metadata instead |
| Group DMs | `sendMessage({ to: [...] })`, `createGroupDirect` | No | Every Forge handoff has one recipient; the room covers many-party traffic |
| Inbox defer | `inbox.defer` | No | Forge has no "later" state for a handoff; failures stop the campaign instead |
| Inbox summary | `inbox.get` (unread channels/DMs/mentions) | No | Recipients ack on receipt, so unread is always zero; the UI's unread counts are per viewer |
| Presence | `agents.presence`, heartbeats | No | Presence needs each agent to hold its own node WebSocket, which auto-acks deliveries on receipt (see below) |
| Files / attachments | `files.upload/get/download`, `attachments` | No | Artifacts already live in Forge's content-addressed store; probed working (`attachments: [fileId]`) |
| Agent-scoped events | `agent.connect`, `relay.addListener` on registered agents | No, deliberately | Connecting opens `/v1/node/ws` with `autoAckDeliveries: true` (`@relaycast/sdk/dist/agent.js:162`): the transport would ack before Forge verified or handled anything |
| Actions / capabilities | `registerAction`, `commands.*` | No | Forge's typed operations are Terse actor commands with their own authority |
| Placement / nodes / harnesses | `placement.spawn`, `nodes.*`, `@agent-relay/harness-driver` | No | Forge runs its own worker processes |
| Webhooks / subscriptions / triggers | `webhooks.*`, `integrations.*`, `triggers.*` | No | No external system consumes Forge events yet |
| Sessions events | `sessionEvents`, `DeliveryRunner` | No | Forge roles are services, not interactive harness sessions |

## Delivery guarantees

- A handoff is delivered only when each recipient has an inbox delivery that matches the
  sender, the route (DM or the campaign room) and the exact text, plus the Forge envelope
  on the Relay record. Then it acks the delivery and marks the message read. The campaign
  pauses otherwise (`engine.send` raises).
- A retry after a lost bridge response returns the same Relay message (idempotency key)
  and proves receipt from the Relay record and the DM conversation.
- A corrupted copy is failed in Relay (`inbox.fail`) and nothing downstream runs.
- Orchestrator: Relay acks follow the authoritative Forge acknowledgement; a stale
  delivery (Forge acked, Relay ack lost) is closed without re-running the handler; a
  message beyond the inbox page is reconciled by its recorded Relay ID; the fault
  scenario asserts every inbox is empty at the end.

## Bridge boundary

The bridge speaks for every agent, so `services/relay/boundary.mjs` refuses any Host other
than `127.0.0.1:<port>`/`localhost:<port>`, any browser `Origin`, any request without the
per-launch bearer secret (except `GET /health`), and non-JSON POSTs. `scripts/lab.py`
issues the secret to the bridge and the API (`data/relay-bridge.token`, 0600).

## Hosted workspace

The SDK talks to the hosted engine at `https://cast.agentrelay.com` with a workspace key
(`rk_live_...`). That key is what Forge needs: it registers the five agent identities,
mints the read-only observer token for push, and sends and reads as those agents.

1. Put the key in `.env` (or the shell) as `FORGE_RELAY_WORKSPACE_KEY=rk_live_...` and leave
   `FORGE_RELAY_URL` empty.
2. `npm run lab`. The bridge skips the local engine, registers `director`, `data`,
   `trainer`, `evaluator` and `governance` in that workspace, and `/health` reports
   `"workspace": "hosted"`.

The read-only sessions token from the dashboard's Agent access page cannot send messages
and does not work here. Public docs do not show a dashboard page that reveals an existing
workspace's `rk_live_` key; the documented ways to obtain one are creating a workspace
(`POST /v1/workspaces`, or `agent-relay workspace create <name>`), which returns the key
once.
