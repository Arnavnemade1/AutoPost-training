// A real SDK/server round trip against a disposable loopback database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { AgentRelay } from "@agent-relay/sdk";

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
  console.log(
    "Relay SDK round trip, recipient identity and duplicate delivery: passed.",
  );
} finally {
  child.kill("SIGTERM");
  const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
  if (child.exitCode === null) await once(child, "exit");
  clearTimeout(kill);
  await rm(directory, { recursive: true, force: true });
}
