import { AgentRelay } from "@agent-relay/sdk";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dispatcher, roles } from "./delivery.mjs";

const baseUrl = process.env.FORGE_RELAY_URL || "http://127.0.0.1:7528";
const names = roles;
await mkdir("data", { recursive: true });
let saved;
try {
  saved = JSON.parse(await readFile("data/relay-credentials.json", "utf8"));
} catch {
  /* First boot. */
}
const relay = saved
  ? new AgentRelay({ workspaceKey: saved.key, baseUrl })
  : await AgentRelay.createWorkspace({ name: "Forge Research Lab", baseUrl });
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
  JSON.stringify({ key: relay.workspaceKey, tokens }),
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
          transport: "Agent Relay 14 / Relaycast 8.10.1",
          local: true,
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
// The bridge serves the address the API posts to, so a second lab can run on other ports.
const port = Number(
  new URL(process.env.FORGE_RELAY_BRIDGE || "http://127.0.0.1:7529").port || 7529,
);
server.listen(port, "127.0.0.1", () =>
  console.log(`Forge Agent Relay bridge ready on ${port}`),
);
process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
