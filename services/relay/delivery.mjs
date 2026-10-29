// Recipient assignment and campaign room are both durable Relay messages.
export const roles = ["director", "data", "trainer", "evaluator", "governance"];

export function dispatcher(agents) {
  const rooms = new Map();
  const pending = new Map();
  async function room(campaign) {
    if (!rooms.has(campaign)) {
      const ready = (async () => {
        const name = `research-${campaign}`;
        // List first: reconnecting must reuse the existing room after a restart.
        const existing = await agents.director.channels.list();
        if (!existing.some((channel) => channel.name === name)) {
          await agents.director.channels.create({ name });
        }
        for (const role of roles) await agents[role].channels.join(name);
        const channel = await agents.director.channels.get(name);
        const members = await agents.director.channels.members(name);
        if (!roles.every((role) => members.some((member) => member.agentName === role)))
          throw new Error("Campaign room is missing a research participant");
        return { name, id: channel.id };
      })();
      rooms.set(campaign, ready);
      ready.catch(() => rooms.delete(campaign));
    }
    return rooms.get(campaign);
  }
  async function deliver(m) {
    if (!roles.includes(m.sender) || !roles.includes(m.recipient) ||
        typeof m.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(m.id) ||
        typeof m.campaign_id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(m.campaign_id) ||
        typeof m.text !== "string" || !m.text.trim())
      throw new Error("Invalid message contract");
    const bytes = JSON.stringify(m);
    const key = `${m.campaign_id}:${m.id}`;
    const prior = pending.get(key);
    if (prior) {
      if (prior.bytes !== bytes) throw new Error("Assignment ID conflict");
      return prior.promise;
    }
    const promise = (async () => {
      const channel = await room(m.campaign_id);
      const direct = await agents[m.sender].sendMessage({
        to: `@${m.recipient}`, text: bytes, idempotencyKey: `${key}:assignment`,
      });
      const inbox = await agents[m.recipient].messages.get(direct.messageId);
      if (inbox.text !== bytes || inbox.from.name !== m.sender)
        throw new Error("Recipient readback did not match the dispatched assignment");
      const group = await agents[m.sender].sendMessage({
        to: `#${channel.name}`, text: bytes, idempotencyKey: `${key}:room`,
      });
      for (const role of roles) {
        const copy = await agents[role].messages.get(group.messageId);
        if (copy.text !== bytes || copy.from.name !== m.sender || copy.channel?.id !== channel.id)
          throw new Error("Campaign room readback failed");
      }
      return {
        message_id: direct.messageId, delivered: true, recipient: m.recipient,
        transport: "Agent Relay", recipient_readback_verified: true,
        room: { name: channel.name, id: channel.id, message_id: group.messageId,
          readback_verified: true, readers: [...roles] },
      };
    })();
    pending.set(key, { bytes, promise });
    promise.catch(() => pending.delete(key));
    return promise;
  }
  return { deliver };
}
