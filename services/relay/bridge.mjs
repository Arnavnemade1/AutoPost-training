import { AgentRelay } from "@agent-relay/sdk";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dispatcher, roles } from "./delivery.mjs";

const baseUrl = (
  process.env.FORGE_RELAY_URL || "http://127.0.0.1:7528"
).replace(/\/+$/, "");
const local = ["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname);
const names = roles;
await mkdir("data", { recursive: true });
let saved;
try {
  saved = JSON.parse(await readFile("data/relay-credentials.json", "utf8"));
  // Credentials belong to one engine; a key for the local engine means nothing hosted.
  if ((saved.baseUrl ?? "http://127.0.0.1:7528") !== baseUrl) saved = undefined;
} catch {
  /* First boot. */
}
const relay = saved
  ? new AgentRelay({ workspaceKey: saved.key, baseUrl })
  : // Hosted workspace names are global and idempotent (the key is returned only on first
    // creation), so the name carries a random suffix.
    await AgentRelay.createWorkspace({
      name: `Forge Research Lab ${randomUUID().slice(0, 8)}`,
      baseUrl,
    });
const agents = {};
const tokens = saved?.tokens || {};
for (const name of names) {
  agents[name] = tokens[name]
    ? await relay.workspace.reconnect({ apiToken: tokens[name] })
    : await relay.workspace.register({ name, type: "agent" });
  tokens[name] = agents[name].apiToken ?? agents[name].token ?? tokens[name];
}
await writeFile(
  "data/relay-credentials.json",
  JSON.stringify({ baseUrl, key: relay.workspaceKey, tokens }),
  { mode: 0o600 },
);

const dispatch = dispatcher(agents);
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    if (req.url === "/health")
      return res.end(
        JSON.stringify({
          ok: true,
          agents: names,
          transport: local
            ? "SDK 14.0.0 · Engine 12.0.0"
            : "SDK 14.0.0 · Relaycast API v1",
          local,
          endpoint: new URL(baseUrl).host,
        }),
      );
    if (req.method !== "POST" || req.url !== "/message") {
      res.writeHead(404);
      return res.end("{}");
    }
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 20000) throw new Error("Message too large");
    }
    const m = JSON.parse(body);
    res.end(JSON.stringify(await dispatch.deliver(m)));
  } catch (error) {
    res.writeHead(503);
    res.end(JSON.stringify({ error: error.message }));
  }
});
const port = Number(process.env.FORGE_RELAY_BRIDGE_PORT || 7529);
server.listen(port, "127.0.0.1", () =>
  console.log(`Forge Agent Relay bridge ready on ${port}`),
);
process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
