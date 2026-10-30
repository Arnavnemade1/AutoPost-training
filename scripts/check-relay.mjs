// A real SDK/server round trip against a disposable loopback database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { AgentRelay } from "@agent-relay/sdk";
import { dispatcher, roles } from "../services/relay/delivery.mjs";

const directory = await mkdtemp(join(tmpdir(), "forge-relay-check-"));
const child = spawn(
  process.execPath,
  [resolve("services/relay/server.mjs"), join(directory, "relay.db"), "0"],
  {
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let errors = "";
child.stderr.on("data", (chunk) => {
  errors = (errors + chunk.toString()).slice(-3000);
});
try {
  const baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Relay startup timed out: ${errors}`)),
      15000,
    );
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.url) {
          clearTimeout(timer);
          lines.close();
          resolve(parsed.url);
        }
      } catch {
        /* Engine diagnostic line. */
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Relay exited ${code}: ${errors}`));
    });
  });
  const relay = await AgentRelay.createWorkspace({
    name: "Forge transport mechanics",
    baseUrl,
  });
  const sender = await relay.workspace.register({
    name: "sender",
    type: "agent",
  });
  const recipient = await relay.workspace.register({
    name: "recipient",
    type: "agent",
  });
  const text = JSON.stringify({
    kind: "mechanics_check",
    action: "verify recipient readback",
  });
  const first = await sender.sendMessage({
    to: "@recipient",
    text,
    idempotencyKey: "same-assignment",
  });
  const duplicate = await sender.sendMessage({
    to: "@recipient",
    text,
    idempotencyKey: "same-assignment",
  });
  assert.equal(
    first.messageId,
    duplicate.messageId,
    "Duplicate assignment created another message",
  );
  const delivered = await recipient.messages.get(first.messageId);
  assert.equal(delivered.text, text);
  assert.equal(delivered.from.name, "sender");
  const agents = {};
  for (const name of roles) agents[name] = await relay.workspace.register({ name, type: "agent" });
  const dispatch = dispatcher(agents);
  const assignment = { id: "first", campaign_id: "mechanics", sender: "director", recipient: "trainer", text: "Train only after verified delivery." };
  const receipt = await dispatch.deliver(assignment);
  assert.equal(receipt.room.readers.length, 5);
  assert.equal(receipt.room.readback_verified, true);
  assert.deepEqual(await dispatch.deliver(assignment), receipt);
  // A lost bridge response/restart reconciles the same durable IDs, not new copies.
  assert.deepEqual(await dispatcher(agents).deliver(assignment), receipt);
  await assert.rejects(dispatch.deliver({ ...assignment, text: "Changed instruction" }), /conflict/);
  await assert.rejects(dispatcher(agents).deliver({ ...assignment, text: "Changed after restart" }), /different request payload/);
  const [a, b] = await Promise.all([dispatch.deliver({ ...assignment, id: "concurrent" }), dispatch.deliver({ ...assignment, id: "concurrent" })]);
  assert.equal(a.room.message_id, b.room.message_id);
  // Room failure after DM: no downstream receipt until all five copies verify.
  const realGet = agents.governance.messages.get.bind(agents.governance.messages);
  let corrupt = true;
  agents.governance.messages.get = async (id) => {
    const copy = await realGet(id);
    return corrupt ? { ...copy, channel: { id: "wrong-room" } } : copy;
  };
  await assert.rejects(dispatch.deliver({ ...assignment, id: "room-retry" }), /room readback/);
  corrupt = false;
  const recovered = await dispatch.deliver({ ...assignment, id: "room-retry" });
  assert.equal(recovered.room.readback_verified, true);
  const page = await agents.trainer.messages.list(receipt.room.name, { limit: 100 });
  assert.equal(page.filter((row) => JSON.parse(row.text).id === "room-retry").length, 1);
  console.log(
    "Relay SDK: real DM + five-role room, duplicates, concurrent send, restart, conflicting payload, wrong room and partial-delivery recovery passed.",
  );
} finally {
  child.kill("SIGTERM");
  const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
  if (child.exitCode === null) await once(child, "exit");
  clearTimeout(kill);
  await rm(directory, { recursive: true, force: true });
}
