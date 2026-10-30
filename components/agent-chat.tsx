"use client";
import { useEffect, useRef, useState } from "react";
import { Agent, Campaign, Event, agentNames } from "@/lib/types";
import { Icon } from "./icon";
import { Empty } from "./views";

const members: Agent[] = [
  "director",
  "data",
  "trainer",
  "evaluator",
  "governance",
];
const initials: Record<Agent, string> = {
  director: "RD",
  data: "DR",
  trainer: "TE",
  evaluator: "EV",
  governance: "GC",
};

export function AgentChat({
  campaign,
  events,
}: {
  campaign: Campaign | null;
  events: Event[];
}) {
  const [follow, setFollow] = useState(true);
  const thread = useRef<HTMLDivElement>(null);
  const messages = events.filter((e) => e.kind === "message" && e.relay_id);
  const room = messages.find((e) => e.receipt?.room?.readback_verified)?.receipt
    ?.room;
  const pending =
    events.filter((e) => e.kind === "message_pending").length - messages.length;
  useEffect(() => {
    if (follow && thread.current)
      thread.current.scrollTop = thread.current.scrollHeight;
  }, [messages.length, follow]);
  return (
    <section className="research-room" aria-label="Agent Relay research room">
      <header className="room-header">
        <div className="room-portraits" aria-hidden="true">
          {members.slice(0, 3).map((m) => (
            <span key={m}>{initials[m]}</span>
          ))}
        </div>
        <div>
          <h2>Research room</h2>
          <p>Five roles. One shared task.</p>
        </div>
        <span className="room-provider">
          <Icon name="message" size={16} />
          Agent Relay
        </span>
      </header>
      <div className="room-members" aria-label="Research participants">
        {members.map((m) => (
          <span key={m}>
            <span className="role-avatar" aria-hidden="true">
              {initials[m]}
            </span>
            {agentNames[m]}
          </span>
        ))}
      </div>
      <div className="room-context">
        <span>{room ? `#${room.name}` : "Preserved direct handoffs"}</span>
        <span>
          {messages.length} verified deliveries
          {pending > 0 ? ` · ${pending} awaiting confirmation` : ""}
        </span>
      </div>
      <div
        className="chat-thread"
        ref={thread}
        tabIndex={0}
        aria-label="Research messages"
        onScroll={() => {
          const el = thread.current;
          if (el)
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
      >
        {messages.length ? (
          <>
            <p className="chat-date">
              {new Date(messages[0].timestamp).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })}{" "}
              · UTC
            </p>
            <ol>
              {messages.map((e) => (
                <li
                  key={e.id}
                  className={`chat-message ${e.agent === "director" ? "chat-outgoing" : ""}`}
                >
                  <span className="role-avatar" aria-hidden="true">
                    {initials[e.agent]}
                  </span>
                  <div className="chat-message-content">
                    <div className="chat-sender">
                      <strong>{agentNames[e.agent]}</strong>
                      <span>
                        to{" "}
                        {e.recipient
                          ? agentNames[e.recipient]
                          : "research team"}
                      </span>
                    </div>
                    <div className="chat-bubble">
                      <span className="chat-category">
                        {e.category?.replaceAll("_", " ").toLowerCase()}
                      </span>
                      <p>{e.text}</p>
                      {e.experiment_id && (
                        <span className="chat-experiment mono">
                          {e.experiment_id}
                        </span>
                      )}
                    </div>
                    <div className="chat-receipt">
                      <time dateTime={e.timestamp}>
                        {new Date(e.timestamp).toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          timeZone: "UTC",
                        })}
                      </time>
                      <span>
                        <Icon name="check" size={12} />
                        {e.receipt?.room?.readback_verified
                          ? "Read back by all 5 roles"
                          : e.receipt?.recipient_readback_verified
                            ? "Recipient readback verified"
                            : "Relay delivery recorded"}
                      </span>
                    </div>
                    <details className="chat-proof">
                      <summary>Delivery evidence</summary>
                      <dl>
                        <dt>Assignment message</dt>
                        <dd>{e.relay_id}</dd>
                        {e.receipt?.room && (
                          <>
                            <dt>Room message</dt>
                            <dd>{e.receipt.room.message_id}</dd>
                            <dt>Room</dt>
                            <dd>{e.receipt.room.name}</dd>
                          </>
                        )}
                      </dl>
                    </details>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <Empty
            icon="message"
            title="The research room is ready"
            description={
              campaign
                ? "The first assignment appears after Agent Relay confirms delivery. Each role's real handoffs stay here."
                : "Launch a campaign to bring the research team into the room."
            }
          />
        )}
      </div>
      <footer className="room-footer">
        <span>
          <Icon name="lock" size={15} />
          Automated research transcript
        </span>
        <button
          className="text-button"
          onClick={() => {
            setFollow(true);
            if (thread.current)
              thread.current.scrollTop = thread.current.scrollHeight;
          }}
        >
          Latest messages
          <Icon name="down" size={14} />
        </button>
      </footer>
    </section>
  );
}
