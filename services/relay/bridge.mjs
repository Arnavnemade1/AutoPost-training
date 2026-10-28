import { AgentRelay } from '@agent-relay/sdk';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const baseUrl = process.env.FORGE_RELAY_URL || 'http://127.0.0.1:7528';
const names = ['director', 'data', 'trainer', 'evaluator', 'governance'];
await mkdir('data', { recursive: true });
let saved;
try { saved = JSON.parse(await readFile('data/relay-credentials.json', 'utf8')); } catch { /* First boot. */ }
const relay = saved ? new AgentRelay({ workspaceKey: saved.key, baseUrl }) : await AgentRelay.createWorkspace({ name: 'Forge Research Lab', baseUrl });
const agents = {};
const tokens = saved?.tokens || {};
for (const name of names) {
  agents[name] = tokens[name] ? await relay.workspace.reconnect({ apiToken: tokens[name] }) : await relay.workspace.register({ name, type: 'agent' });
  tokens[name] = agents[name].apiToken ?? agents[name].token ?? tokens[name];
}
await writeFile('data/relay-credentials.json', JSON.stringify({ key: relay.workspaceKey, tokens }), { mode: 0o600 });

// The event listener records authentic receipts. A send is not treated as executed work.
const received = new Map();
relay.addListener('message.created', ({ message }) => { received.set(message.messageId, message); });
const processed = new Map();
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.url === '/health') return res.end(JSON.stringify({ ok: true, agents: names, transport: 'Agent Relay 14 / Relaycast 8.10.1', local: true }));
    if (req.method !== 'POST' || req.url !== '/message') { res.writeHead(404); return res.end('{}'); }
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 20000) throw new Error('Message too large'); }
    const m = JSON.parse(body);
    if (!names.includes(m.sender) || !names.includes(m.recipient) || !m.id || typeof m.text !== 'string') throw new Error('Invalid message contract');
    if (processed.has(m.id)) return res.end(JSON.stringify(processed.get(m.id)));
    const result = await agents[m.sender].sendMessage({ to: `@${m.recipient}`, text: JSON.stringify(m), idempotencyKey: m.id });
    // Read from the recipient's durable inbox, so a late listener can reconcile it.
    const delivered = await agents[m.recipient].messages.get(result.messageId);
    if (delivered.text !== JSON.stringify(m) || delivered.from.name !== m.sender) throw new Error('Recipient readback did not match the dispatched assignment');
    const receipt = { message_id: result.messageId, delivered: true, recipient: m.recipient, transport: 'Agent Relay', recipient_readback_verified: true };
    processed.set(m.id, receipt);
    res.end(JSON.stringify(receipt));
  } catch (error) {
    res.writeHead(503); res.end(JSON.stringify({ error: error.message }));
  }
});
server.listen(7529, '127.0.0.1', () => console.log('Forge Agent Relay bridge ready on 7529'));
process.on('SIGTERM', () => { server.close(); process.exit(0); });
