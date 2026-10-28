import { AgentRelay, type RelayAgentClient } from "@agent-relay/sdk";
import type { ForgeActorClient } from "../../../packages/terse-actors/src/client.js";
import type { Document, Role } from "../../../packages/terse-actors/src/contracts.js";
import { canonical, digest } from "../../../packages/terse-actors/src/core.js";
import type { Delivery, WorkflowMessage } from "../../../packages/terse-actors/src/workflow.js";

export const participantRoles = [
  "director",
  "data",
  "reviewer",
  "coordinator",
  "worker",
  "evaluator",
] as const;
export type ParticipantRole = (typeof participantRoles)[number];
export type Participants = Record<ParticipantRole, RelayAgentClient>;
type RelayMessage = Awaited<ReturnType<RelayAgentClient["messages"]["get"]>>;

export async function registerParticipants(relay: AgentRelay): Promise<Participants> {
  const participants = {} as Participants;
  for (const role of participantRoles) {
    participants[role] = await relay.workspace.register(
      { name: `forge-${role}`, type: "agent" },
      { strict: true },
    );
    await participants[role].channels.create({ name: `forge-${role}` });
  }
  // Channels are transport routing, not actor authorization boundaries.
  for (const role of participantRoles)
    for (const recipient of participantRoles)
      if (role !== recipient) await participants[role].channels.join(`forge-${recipient}`);
  return participants;
}

export interface ReceiveReport {
  /** Handled from the recipient's own Relay channel history. */
  viaRelay: number;
  /** Recorded as sent but absent from the channel page; fetched by its Relay ID. */
  viaReconciliation: number;
  /** Extra verified copies of a pending message; handled once. */
  duplicateCopies: number;
  /** Copies claiming a pending message ID whose sender, channel or bytes do not match. */
  rejectedCopies: number;
}

/** The persisted outbox is authoritative. SDK transport acceptance is not work completion. */
export class RelayDispatcher {
  constructor(
    readonly campaignId: string,
    readonly actors: Record<Role, ForgeActorClient>,
    readonly participants: Participants,
    /** Channel page size; older pending messages are reconciled by their recorded Relay ID. */
    readonly historyLimit = 100,
  ) {}
  async deliveries(): Promise<Delivery[]> {
    const snapshot = await this.actors.coordinator.read(
      "ResearchWorkflowActor",
      this.campaignId,
      "getSnapshot",
    );
    const rows = Object.values(snapshot!.deliveries as unknown as Record<string, Delivery>);
    return rows.sort((a, b) => a.sequence - b.sequence);
  }
  async pending(): Promise<{ unsent: string[]; unacknowledged: string[] }> {
    const rows = await this.deliveries();
    return {
      unsent: rows.filter((d) => !d.relayMessageId).map((d) => d.message.messageId),
      unacknowledged: rows
        .filter((d) => d.relayMessageId && !d.acknowledged)
        .map((d) => d.message.messageId),
    };
  }
  async flush(afterSend?: (delivery: Delivery, relayMessageId: string) => Promise<void>) {
    let sent = 0;
    for (const delivery of await this.deliveries()) {
      if (delivery.acknowledged || delivery.relayMessageId) continue;
      const m = delivery.message;
      // The idempotency key lets a resend after a lost response return the original post.
      const result = await this.participants[m.senderRole as ParticipantRole].sendMessage({
        to: `#forge-${m.recipientRole}`,
        text: canonical(m),
        idempotencyKey: digest({ campaignId: this.campaignId, messageId: m.messageId }),
      });
      // Failure injection exercises lost responses before recording the transport receipt.
      if (afterSend) await afterSend(delivery, result.messageId);
      await this.actors.coordinator.command(
        "ResearchWorkflowActor",
        this.campaignId,
        this.campaignId,
        "markSent",
        { messageId: m.messageId, relayMessageId: result.messageId },
        `sent-${m.messageId}`,
      );
      sent++;
    }
    return sent;
  }
  /**
   * Consumes the recipient's Relay channel, then reconciles anything the outbox recorded as
   * sent that the channel page did not return. Handlers receive the durable message, never
   * transport text, and must be idempotent: a lost acknowledgement re-runs them.
   */
  async receive(
    role: ParticipantRole,
    handler: (message: WorkflowMessage) => Promise<void>,
  ): Promise<ReceiveReport> {
    const report: ReceiveReport = {
      viaRelay: 0,
      viaReconciliation: 0,
      duplicateCopies: 0,
      rejectedCopies: 0,
    };
    const pending = (await this.deliveries()).filter(
      (d) => !d.acknowledged && d.relayMessageId && d.message.recipientRole === role,
    );
    if (!pending.length) return report;
    const client = this.participants[role];
    const channel = await client.channels.get(`forge-${role}`);
    const genuine = (incoming: RelayMessage, expected: WorkflowMessage) =>
      incoming.from.name === `forge-${expected.senderRole}` &&
      incoming.channel?.id === channel.id &&
      incoming.text === canonical(expected);
    const copies = new Map<string, RelayMessage[]>();
    for (const incoming of await client.messages.list(`forge-${role}`, {
      limit: this.historyLimit,
    })) {
      let messageId: unknown;
      try {
        messageId = (JSON.parse(incoming.text) as Document).messageId;
      } catch {
        continue; // Not a workflow message.
      }
      if (typeof messageId === "string")
        copies.set(messageId, [...(copies.get(messageId) ?? []), incoming]);
    }
    for (const delivery of pending) {
      const expected = delivery.message;
      const seen = copies.get(expected.messageId) ?? [];
      const verified = seen.filter((incoming) => genuine(incoming, expected));
      report.rejectedCopies += seen.length - verified.length;
      if (verified.length) {
        report.viaRelay++;
        report.duplicateCopies += verified.length - 1;
      } else {
        const recorded = await client.messages.get(delivery.relayMessageId!);
        if (!genuine(recorded, expected))
          throw new Error("RELAY_EVIDENCE_MISMATCH: delivery does not match the durable message");
        report.viaReconciliation++;
      }
      await handler(expected);
      await this.actors[role].command(
        "ResearchWorkflowActor",
        this.campaignId,
        this.campaignId,
        "acknowledge",
        { messageId: expected.messageId },
        `ack-${expected.messageId}`,
      );
    }
    return report;
  }
  async publish(
    role: ParticipantRole,
    messageId: string,
    experimentId: string,
    kind: string,
    body: Document,
  ): Promise<void> {
    await this.actors[role].command(
      "ResearchWorkflowActor",
      this.campaignId,
      this.campaignId,
      "publish",
      { messageId, experimentId, kind, body },
      `queue-${messageId}`,
    );
  }
}
