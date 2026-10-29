# Hosted Agent Relay verification

Date: 2026-10-29. Branch `forge/autonomous-lab`, macOS arm64, SDK `@agent-relay/sdk@14.0.0`,
hosted engine `https://cast.agentrelay.com` (Relaycast v1 API).

Until this record, every Relay check ran against a loopback `@relaycast/engine`. The same
code now runs against the hosted engine when `FORGE_RELAY_URL` is set; unset, nothing
changes.

## How a run uses the hosted engine

- `POST /v1/workspaces` needs no account. Workspace names are global and idempotent and
  the `rk_live_` key is returned only on first creation, so every run creates
  `<label>-<random suffix>` (`services/orchestrator/scripts/relay-target.ts`).
- Reports record the engine URL and workspace names, never keys or agent tokens.
- On exit the run deletes its workspaces (`DELETE /v1/workspace`). Set
  `FORGE_RELAY_KEEP_WORKSPACE=1` to keep one for inspection.
- The scenario's Relay SIGKILL fault cannot apply to an engine we do not run. Against a
  remote engine every Relay client is dropped and reconnected from persisted tokens, and
  the report lists `relay-client-reconnect` in place of `relay-sigkill`. The Terse SIGKILL
  and every other fault are unchanged.

## Executed checks

| Check | Command | Result |
| --- | --- | --- |
| SDK probe | throwaway script: create, register, send twice with one idempotency key, list, reconnect, delete | same message ID for both sends; reconnect read the message; delete 204 |
| Phase 3 lifecycle | `FORGE_RELAY_URL=https://cast.agentrelay.com npm run demo` | 9 workflow messages sent and acknowledged in causal order; worker receipt `viaRelay 1, duplicateCopies 1, rejectedCopies 1`; correction reconciled from its Relay ID (`viaReconciliation 1`); final reconciliation empty; one optimization run; governance veto honored |
| Phase 3 test suite | `FORGE_RELAY_URL=https://cast.agentrelay.com npm test -- tests/phase3.test.ts` | 4 pass, 0 fail (89 s; 49 s against the loopback engine) |
| Research campaign | `FORGE_RELAY_URL=https://cast.agentrelay.com npm run research -- fixture` | director campaign completed over the hosted engine; outbox reconciliation empty; stop rule `NO_FURTHER_IMPROVEMENT` |
| Command center bridge | `services/relay/bridge.mjs` with `FORGE_RELAY_URL` set, scratch working directory | health reports `local: false`; assignment delivered with recipient and five-reader room readback; resend returned the same message ID; changed bytes under the same ID refused; after a restart the saved credentials reconnected and delivered again |
| Workspace cleanup | `GET /v1/workspaces/by-name/<name>` | 200 while a workspace exists, 404 after its run; every workspace created above returned 404 |

The hosted `messages.get` response carries `channel.id` but not `channel.name`. Recipient
verification already compares channel IDs, so it is unaffected.

CI runs the Phase 3 suite against the hosted engine on every orchestrator change, after
the loopback suite (`.github/workflows/orchestrator.yml`).

## Not verified

- An Agent Relay Cloud account workspace (Teams, Flows or Relay Connect). These runs use
  anonymous Relaycast workspaces.
- Separate processes and credentials per role. One process still holds every Relay
  token, as in the local harness.
- Push delivery. Recipients still poll; Relay inbox acknowledgements and push
  subscriptions are not used.
- Hosted rate limits or quotas under a long real-model campaign. Only the fixture
  campaign ran against the hosted engine.
