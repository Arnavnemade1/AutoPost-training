import { createHash } from "node:crypto";

export const HOSTED_RELAY_URL = "https://cast.agentrelay.com";

/**
 * Where Forge's agents talk. Default: the local Relaycast engine started by `npm run lab`.
 * Hosted: set FORGE_RELAY_WORKSPACE_KEY to an Agent Relay workspace key (rk_live_...);
 * the base URL then defaults to the hosted engine. The key is never written to disk.
 */
export function relayConfig(env) {
  const workspaceKey = env.FORGE_RELAY_WORKSPACE_KEY?.trim() || undefined;
  if (workspaceKey && !workspaceKey.startsWith("rk_"))
    throw new Error(
      "FORGE_RELAY_WORKSPACE_KEY must be an Agent Relay workspace key (rk_live_...)",
    );
  const hosted = Boolean(workspaceKey);
  const baseUrl = (
    env.FORGE_RELAY_URL || (hosted ? HOSTED_RELAY_URL : "http://127.0.0.1:7528")
  ).replace(/\/+$/, "");
  const bridgePort = Number(env.FORGE_RELAY_BRIDGE_PORT || 7529);
  if (!Number.isInteger(bridgePort) || bridgePort <= 0)
    throw new Error("Invalid FORGE_RELAY_BRIDGE_PORT");
  // Agent tokens belong to one workspace; a fingerprint (not the key) tells them apart.
  const workspaceId = hosted
    ? `hosted:${createHash("sha256").update(workspaceKey).digest("hex").slice(0, 16)}@${baseUrl}`
    : `local@${baseUrl}`;
  return {
    hosted,
    workspaceKey,
    baseUrl,
    bridgePort,
    workspaceId,
    credentialsPath:
      env.FORGE_RELAY_CREDENTIALS || "data/relay-credentials.json",
  };
}
