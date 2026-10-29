import { AgentRelay } from "@agent-relay/sdk";
import { RelayCast } from "@relaycast/sdk";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dispatcher, pushWaiter, roles } from "./delivery.mjs";
import { relayConfig } from "./config.mjs";

const config = relayConfig(process.env);
await mkdir("data", { recursive: true });
let saved;
try {
  saved = JSON.parse(await readFile(config.credentialsPath, "utf8"));
} catch {
  /* First boot. */
}
// A hosted workspace is reached with Vir's workspace key from the environment, never from
// disk. A local engine mints its own workspace on first boot and keeps the key under data/.
const workspaceKey = config.workspaceKey ?? saved?.key;
const relay = workspaceKey
  ? new AgentRelay({ workspaceKey, baseUrl: config.baseUrl })
  : await AgentRelay.createWorkspace({
      name: "Forge Research Lab",
      baseUrl: config.baseUrl,
    });
const agents = {};
const tokens =
  saved?.workspace === config.workspaceId ? saved?.tokens || {} : {};
for (const name of roles) {
  agents[name] = tokens[name]
    ? await relay.workspace
        .reconnect({ apiToken: tokens[name] })
        .catch(() => relay.workspace.register({ name, type: "agent" }))
    : await relay.workspace.register({ name, type: "agent" });
  tokens[name] = agents[name].token ?? tokens[name];
}
// Recipients are woken by Relay's push stream. A read-only observer token carries it, so
// no participant opens its own node socket (which would ack deliveries on receipt).
let observerToken =
  saved?.workspace === config.workspaceId ? saved?.observerToken : undefined;
if (!observerToken) {
  const admin = new RelayCast({
    apiKey: relay.workspaceKey,
    baseUrl: config.baseUrl,
  });
  const minted = await admin.observerTokens.create({
    name: "forge-bridge-push",
    description: "Wakes Forge recipients when a handoff lands",
    scopes: [
      "stream:read",
      "messages:read",
      "dms:read",
      "channels:read",
      "threads:read",
    ],
    filters: { include_dms: true },
  });
  observerToken = minted.token;
}
await writeFile(
  config.credentialsPath,
  JSON.stringify({
    workspace: config.workspaceId,
    // The hosted key stays in the environment only.
    key: config.workspaceKey ? undefined : relay.workspaceKey,
    tokens,
    observerToken,
  }),
  { mode: 0o600 },
);

const push = pushWaiter();
const observer = new AgentRelay({ observerToken, baseUrl: config.baseUrl });
let pushes = 0;
observer.addListener("*", (event) => {
  pushes++;
  push.observe(event);
});
const dispatch = dispatcher(agents, push);

async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 20000) throw new Error("Message too large");
  }
  return JSON.parse(text);
}

const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    const url = new URL(req.url, "http://bridge");
    if (url.pathname === "/health")
      return res.end(
        JSON.stringify({
          ok: true,
          agents: roles,
          transport: "Agent Relay 14 / Relaycast engine 12",
          workspace: config.hosted ? "hosted" : "local",
          local: !config.hosted,
          push: { stream: "observer", events: pushes },
        }),
      );
    if (req.method === "GET" && url.pathname === "/search")
      return res.end(
        JSON.stringify(
          await dispatch.search({
            campaign_id: url.searchParams.get("campaign_id"),
            q: url.searchParams.get("q"),
          }),
        ),
      );
    if (req.method === "POST" && url.pathname === "/message")
      return res.end(JSON.stringify(await dispatch.deliver(await body(req))));
    if (req.method === "POST" && url.pathname === "/react")
      return res.end(JSON.stringify(await dispatch.react(await body(req))));
    res.writeHead(404);
    return res.end("{}");
  } catch (error) {
    res.writeHead(503);
    res.end(JSON.stringify({ error: error.message }));
  }
});
server.listen(config.bridgePort, "127.0.0.1", () =>
  console.log(
    `Forge Agent Relay bridge ready on ${config.bridgePort} (${config.hosted ? "hosted" : "local"} workspace)`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    server.close();
    process.exit(0);
  });
