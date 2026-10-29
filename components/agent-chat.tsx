"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Agent, Campaign, Event, RelayReaction, agentNames } from "@/lib/types";
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
const shortNames: Record<Agent, string> = {
  director: "Director",
  data: "Data",
  trainer: "Trainer",
  evaluator: "Evaluator",
  governance: "Governance",
};
const BURST_MS = 3 * 60 * 1000;
const DIVIDER_MS = 15 * 60 * 1000;

type Route = "dm" | "room" | "thread";
type ChatMessage = {
  key: string;
  relayId?: string;
  sender: Agent;
  recipient?: Agent;
  category?: string;
  text: string;
  timestamp: string;
  experimentId?: string;
  route: Route;
  parentId?: string | null;
  receipt?: Event["receipt"];
  pending: boolean;
};
type Conversation = {
  id: string;
  kind: "room" | "dm";
  title: string;
  members: Agent[];
  /** The side drawn on the right, in the accent color. */
  self: Agent;
  messages: ChatMessage[];
};

const isAgent = (value: unknown): value is Agent =>
  typeof value === "string" && (members as string[]).includes(value);

function pairId(a: Agent, b: Agent) {
  const [x, y] = [a, b].sort((p, q) => members.indexOf(p) - members.indexOf(q));
  return `dm:${x}:${y}`;
}

/** Builds conversations from the durable event journal; tolerant of older receipts. */
function conversations(events: Event[]) {
  const delivered = events.filter(
    (e) => e.kind === "message" && e.relay_id && isAgent(e.agent),
  );
  const deliveredIds = new Set(delivered.map((e) => e.message_id));
  const messages: ChatMessage[] = delivered.map((e) => ({
    key: e.id,
    relayId: e.relay_id,
    sender: e.agent,
    recipient: isAgent(e.recipient) ? e.recipient : undefined,
    category: e.category,
    text: e.text,
    timestamp: e.timestamp,
    experimentId: e.experiment_id,
    // Earlier receipts posted every handoff to the room as well as the DM.
    route: e.route ?? e.receipt?.route ?? "room",
    parentId: e.thread_parent_id,
    receipt: e.receipt,
    pending: false,
  }));
  for (const e of events) {
    if (e.kind !== "message_pending" || !e.message?.id) continue;
    if (deliveredIds.has(e.message.id) || !isAgent(e.agent)) continue;
    const reply = (e.message as { reply_to?: string | null }).reply_to;
    messages.push({
      key: e.id,
      sender: e.agent,
      recipient: isAgent(e.message.recipient) ? e.message.recipient : undefined,
      category: e.message.category,
      text: e.text,
      timestamp: e.timestamp,
      route: reply ? "thread" : (e.message.route ?? "dm"),
      parentId: reply ?? null,
      pending: true,
    });
  }
  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const byRelay = new Map(
    messages.filter((m) => m.relayId).map((m) => [m.relayId!, m]),
  );
  const replies = new Map<string, ChatMessage[]>();
  const room: Conversation = {
    id: "room",
    kind: "room",
    title: "Research room",
    members,
    self: "director",
    messages: [],
  };
  const dms = new Map<string, Conversation>();
  for (const m of messages) {
    if (m.route === "thread" && m.parentId && byRelay.has(m.parentId)) {
      replies.set(m.parentId, [...(replies.get(m.parentId) ?? []), m]);
      continue;
    }
    if (m.route !== "dm" || !m.recipient || m.recipient === m.sender) {
      room.messages.push(m);
      continue;
    }
    const id = pairId(m.sender, m.recipient);
    if (!dms.has(id)) {
      const pair = [m.sender, m.recipient].sort(
        (p, q) => members.indexOf(p) - members.indexOf(q),
      );
      dms.set(id, {
        id,
        kind: "dm",
        title: `${shortNames[pair[0]]} and ${shortNames[pair[1]]}`,
        members: pair,
        self: pair.includes("director") ? "director" : m.sender,
        messages: [],
      });
    }
    dms.get(id)!.messages.push(m);
  }
  const reactions = new Map<string, RelayReaction[]>();
  for (const e of events)
    if (e.kind === "reaction" && e.relay_id && Array.isArray(e.reactions))
      reactions.set(e.relay_id, e.reactions);
  const list = [
    room,
    ...[...dms.values()].sort((a, b) =>
      last(b).timestamp.localeCompare(last(a).timestamp),
    ),
  ];
  return { list, replies, reactions };
}

const last = (c: Conversation) =>
  c.messages[c.messages.length - 1] ?? {
    timestamp: "",
    text: "",
    sender: "director" as Agent,
  };

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}
function dividerLabel(iso: string) {
  const date = new Date(iso);
  const day = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${day}, ${clock(iso)} UTC`;
}
function listTime(iso: string) {
  if (!iso) return "";
  const date = new Date(iso);
  const sameDay =
    date.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
  return sameDay
    ? clock(iso)
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
}
const humanize = (category?: string) =>
  category
    ? category.charAt(0) + category.slice(1).replaceAll("_", " ").toLowerCase()
    : "";

function receiptLabel(m: ChatMessage, kind: Conversation["kind"]) {
  if (m.pending) return "Sending";
  const readers =
    m.receipt?.read_by?.length ?? m.receipt?.room?.readers?.length;
  if (kind === "dm" || m.route === "dm")
    return m.receipt?.read_by?.length
      ? `Read ${clock(m.receipt.read_by[0].read_at ?? m.timestamp)}`
      : "Delivered";
  return readers ? `Read by ${readers}` : "Delivered";
}

function Avatar({ agent, size = "md" }: { agent: Agent; size?: "sm" | "md" }) {
  return (
    <span
      className={`chat-avatar chat-avatar-${size} ${agent === "director" ? "is-director" : ""}`}
      aria-hidden="true"
    >
      {initials[agent]}
    </span>
  );
}

function ConversationAvatar({ c }: { c: Conversation }) {
  if (c.kind === "room")
    return (
      <span className="convo-avatar convo-avatar-group" aria-hidden="true">
        <Icon name="message" size={18} />
      </span>
    );
  return (
    <span className="convo-avatar convo-avatar-pair" aria-hidden="true">
      <Avatar agent={c.members[0]} size="sm" />
      <Avatar agent={c.members[1]} size="sm" />
    </span>
  );
}

function readSeen(campaignId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(`forge-chat-seen:${campaignId}`);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

type SearchRow = { message_id: string; sender: string; text: string };

export function AgentChat({
  campaign,
  events,
}: {
  campaign: Campaign | null;
  events: Event[];
}) {
  const roomName = campaign ? `research-${campaign.id}` : "research room";
  const { list, replies, reactions } = useMemo(
    () => conversations(events),
    [events],
  );
  const [activeId, setActiveId] = useState("room");
  const [pane, setPane] = useState<"list" | "conversation">("conversation");
  const [thread, setThread] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  // The component remounts per campaign, so the stored read state loads once.
  const [stored, setStored] = useState<Record<string, number>>(() =>
    campaign && typeof window !== "undefined" ? readSeen(campaign.id) : {},
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchRow[] | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "busy" | "error">(
    "idle",
  );
  const scroller = useRef<HTMLDivElement>(null);
  const active = list.find((c) => c.id === activeId) ?? list[0];
  const threadParent = thread
    ? active.messages.find((m) => m.relayId === thread)
    : undefined;
  const shown = threadParent
    ? [threadParent, ...(replies.get(threadParent.relayId!) ?? [])]
    : active.messages;

  // Whatever is on screen counts as read for this viewer.
  const seen =
    pane === "list"
      ? stored
      : { ...stored, [active.id]: active.messages.length };
  const seenKey = JSON.stringify(seen);
  useEffect(() => {
    if (!campaign) return;
    try {
      localStorage.setItem(`forge-chat-seen:${campaign.id}`, seenKey);
    } catch {
      /* Unread state is a convenience; private windows may refuse it. */
    }
  }, [campaign, seenKey]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (highlight) {
      document
        .getElementById(`msg-${highlight}`)
        ?.scrollIntoView({ block: "center" });
      return;
    }
    if (follow) el.scrollTop = el.scrollHeight;
  }, [shown.length, follow, activeId, thread, highlight]);

  const openConversation = (id: string, relayId?: string) => {
    setStored(seen);
    setActiveId(id);
    setThread(null);
    setSelected(relayId ?? null);
    setHighlight(relayId ?? null);
    setFollow(!relayId);
    setPane("conversation");
  };
  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!campaign || !query.trim()) return;
    setSearchState("busy");
    try {
      const r = await fetch(
        `/api/lab/campaigns/${campaign.id}/relay/search?q=${encodeURIComponent(query.trim())}`,
      );
      if (!r.ok) throw new Error(String(r.status));
      const rows = (await r.json()) as unknown;
      setResults(
        Array.isArray(rows)
          ? rows.filter(
              (row): row is SearchRow =>
                typeof row?.message_id === "string" &&
                typeof row?.text === "string",
            )
          : [],
      );
      setSearchState("idle");
    } catch {
      setResults(null);
      setSearchState("error");
    }
  };

  const unread = (c: Conversation) =>
    Math.max(0, c.messages.length - (seen[c.id] ?? 0));
  const inFlight = (c: Conversation) =>
    c.messages.filter((m) => m.pending).length;

  return (
    <section
      className="messenger"
      data-pane={pane}
      aria-label="Agent Relay conversations"
    >
      <aside className="convo-sidebar" aria-label="Conversations">
        <header className="convo-sidebar-head">
          <div>
            <h2>Messages</h2>
            <p>
              <Icon name="connections" size={13} />
              Agent Relay
            </p>
          </div>
        </header>
        <form className="convo-search" role="search" onSubmit={search}>
          <Icon name="search" size={15} />
          <input
            type="search"
            value={query}
            placeholder="Search the research room"
            aria-label="Search the research room with Agent Relay"
            disabled={!campaign}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value) {
                setResults(null);
                setSearchState("idle");
              }
            }}
          />
        </form>
        {searchState === "error" && (
          <p className="convo-search-note" role="status">
            Relay search is unavailable. Check that the bridge is running.
          </p>
        )}
        {results ? (
          <div className="convo-results" aria-live="polite">
            <div className="convo-results-head">
              <span>
                {results.length} {results.length === 1 ? "match" : "matches"} in
                Research room
              </span>
              <button
                className="text-button"
                onClick={() => {
                  setResults(null);
                  setQuery("");
                }}
              >
                Clear
              </button>
            </div>
            <ul>
              {results.map((row) => (
                <li key={row.message_id}>
                  <button
                    onClick={() => openConversation("room", row.message_id)}
                  >
                    <strong>
                      {isAgent(row.sender)
                        ? agentNames[row.sender]
                        : row.sender}
                    </strong>
                    <span>{row.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="convo-list">
            {list.map((c) => {
              const tail = last(c);
              const count = campaign ? unread(c) : 0;
              const sending = inFlight(c);
              return (
                <li key={c.id}>
                  <button
                    className={`convo-row ${c.id === active.id ? "active" : ""}`}
                    aria-current={c.id === active.id ? "true" : undefined}
                    onClick={() => openConversation(c.id)}
                  >
                    <ConversationAvatar c={c} />
                    <span className="convo-row-body">
                      <span className="convo-row-top">
                        <strong>{c.title}</strong>
                        <time dateTime={tail.timestamp || undefined}>
                          {listTime(tail.timestamp)}
                        </time>
                      </span>
                      <span className="convo-row-preview">
                        {c.messages.length
                          ? `${shortNames[tail.sender]}: ${tail.text}`
                          : c.kind === "room"
                            ? "Decisions, checkpoints and verdicts"
                            : "No messages yet"}
                      </span>
                      <span className="convo-row-meta">
                        {c.kind === "room" ? `#${roomName}` : "Direct messages"}
                        {sending > 0 && <em>{sending} sending</em>}
                      </span>
                    </span>
                    {count > 0 && (
                      <span
                        className="convo-unread"
                        aria-label={`${count} unread`}
                      >
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <div className="convo-pane">
        <header className="convo-head">
          <button
            className="convo-back"
            aria-label={
              thread ? "Back to the conversation" : "All conversations"
            }
            onClick={() => {
              if (thread) return setThread(null);
              setStored(seen);
              setPane("list");
            }}
          >
            <Icon name="down" size={18} />
          </button>
          {thread ? (
            <div className="convo-head-title">
              <h3>Thread</h3>
              <p>
                {replies.get(thread)?.length ?? 0}{" "}
                {(replies.get(thread)?.length ?? 0) === 1 ? "reply" : "replies"}{" "}
                in Research room
              </p>
            </div>
          ) : (
            <>
              <ConversationAvatar c={active} />
              <div className="convo-head-title">
                <h3>{active.title}</h3>
                <p>
                  {active.kind === "room"
                    ? `#${roomName} · ${members.length} agents`
                    : `${agentNames[active.members[0]]} and ${agentNames[active.members[1]]}`}
                </p>
              </div>
            </>
          )}
          {thread && (
            <button className="text-button" onClick={() => setThread(null)}>
              Back to room
            </button>
          )}
        </header>
        {!thread && active.kind === "room" && (
          <div className="convo-members" aria-label="Room members">
            {members.map((m) => (
              <span key={m}>
                <Avatar agent={m} size="sm" />
                {agentNames[m]}
              </span>
            ))}
          </div>
        )}
        <div
          className="convo-scroll"
          ref={scroller}
          tabIndex={0}
          aria-label={thread ? "Thread messages" : `${active.title} messages`}
          onScroll={() => {
            const el = scroller.current;
            if (el) {
              setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
              if (highlight) setHighlight(null);
            }
          }}
        >
          {shown.length ? (
            <ol className="bubble-list">
              {shown.map((m, i) => {
                const prev = shown[i - 1];
                const next = shown[i + 1];
                const gap = (a?: ChatMessage, b?: ChatMessage) =>
                  a && b
                    ? Date.parse(b.timestamp) - Date.parse(a.timestamp)
                    : Infinity;
                const divider = gap(prev, m) > DIVIDER_MS;
                const start =
                  divider ||
                  prev?.sender !== m.sender ||
                  gap(prev, m) > BURST_MS;
                const end =
                  !next ||
                  next.sender !== m.sender ||
                  gap(m, next) > BURST_MS ||
                  gap(m, next) > DIVIDER_MS;
                const mine = m.sender === active.self;
                const isLast = i === shown.length - 1;
                const expanded = selected === m.key;
                const threadReplies =
                  !thread && m.relayId ? (replies.get(m.relayId) ?? []) : [];
                const tapbacks = m.relayId
                  ? reactions.get(m.relayId)
                  : undefined;
                return (
                  <li
                    key={m.key}
                    id={m.relayId ? `msg-${m.relayId}` : undefined}
                    className="bubble-item"
                  >
                    {divider && (
                      <p className="bubble-divider">
                        <time dateTime={m.timestamp}>
                          {dividerLabel(m.timestamp)}
                        </time>
                      </p>
                    )}
                    {thread && i === 1 && (
                      <p className="bubble-divider thread-divider">Replies</p>
                    )}
                    <div
                      className={`bubble-row ${mine ? "mine" : "theirs"} ${start ? "start" : ""} ${end ? "end" : ""} ${highlight === m.relayId ? "found" : ""}`}
                    >
                      {!mine && (
                        <span className="bubble-gutter">
                          {end && <Avatar agent={m.sender} />}
                        </span>
                      )}
                      <div className="bubble-col">
                        {start && (!mine || active.kind === "room") && (
                          <span className="bubble-sender">
                            {agentNames[m.sender]}
                            {m.recipient && active.kind === "room" && (
                              <span> to {shortNames[m.recipient]}</span>
                            )}
                          </span>
                        )}
                        <button
                          className={`bubble ${m.pending ? "pending" : ""} ${tapbacks?.length ? "has-tapback" : ""}`}
                          aria-expanded={expanded}
                          onClick={() => setSelected(expanded ? null : m.key)}
                        >
                          {m.category && (
                            <span className="bubble-category">
                              {humanize(m.category)}
                              {m.experimentId && (
                                <span className="mono">{m.experimentId}</span>
                              )}
                            </span>
                          )}
                          <span className="bubble-text">{m.text}</span>
                          {tapbacks?.length ? (
                            <span
                              className={`tapback ${tapbacks.some((r) => r.emoji === "x") ? "is-rejected" : ""}`}
                              aria-label={tapbacks
                                .map(
                                  (r) =>
                                    `${r.emoji === "white_check_mark" ? "Approved" : r.emoji === "x" ? "Rejected" : "Seen"} by ${r.agents.map((a) => (isAgent(a) ? shortNames[a] : a)).join(", ")}`,
                                )
                                .join("; ")}
                            >
                              {tapbacks.map((r) => (
                                <Icon
                                  key={r.emoji}
                                  name={
                                    r.emoji === "white_check_mark"
                                      ? "check"
                                      : r.emoji === "x"
                                        ? "close"
                                        : "search"
                                  }
                                  size={12}
                                />
                              ))}
                            </span>
                          ) : null}
                        </button>
                      </div>
                    </div>
                    {(threadReplies.length > 0 ||
                      isLast ||
                      expanded ||
                      m.pending) && (
                      <div
                        className={`bubble-after ${mine ? "mine" : "theirs"}`}
                      >
                        {threadReplies.length > 0 && (
                          <button
                            className="bubble-thread-link"
                            onClick={() => {
                              setThread(m.relayId!);
                              setSelected(null);
                              setFollow(true);
                            }}
                          >
                            {threadReplies.length}{" "}
                            {threadReplies.length === 1 ? "reply" : "replies"}
                            <span aria-hidden="true">
                              {threadReplies
                                .slice(0, 3)
                                .map((r) => initials[r.sender])
                                .join(" ")}
                            </span>
                          </button>
                        )}
                        {(isLast || expanded || m.pending) && (
                          <span className="bubble-receipt">
                            {!m.pending && <Icon name="check" size={11} />}
                            {receiptLabel(m, active.kind)}
                            {!isLast && !m.pending && (
                              <> · {clock(m.timestamp)}</>
                            )}
                          </span>
                        )}
                        {expanded && (
                          <dl className="bubble-evidence">
                            <dt>Relay message</dt>
                            <dd>{m.relayId ?? "Awaiting Relay receipt"}</dd>
                            <dt>Route</dt>
                            <dd>
                              {m.route === "dm"
                                ? `Direct message${m.receipt?.conversation_id ? `, ${m.receipt.conversation_id}` : ""}`
                                : m.route === "thread"
                                  ? "Thread reply in the research room"
                                  : `#${m.receipt?.room?.name ?? roomName}`}
                            </dd>
                            {m.receipt?.woke_by && (
                              <>
                                <dt>Recipient woken by</dt>
                                <dd>
                                  {m.receipt.woke_by === "push"
                                    ? "Relay push stream"
                                    : "Inbox sweep"}
                                </dd>
                              </>
                            )}
                            {m.receipt?.deliveries?.map((d) => (
                              <div key={d.role}>
                                <dt>{agentNames[d.role] ?? d.role}</dt>
                                <dd>
                                  {d.delivery_id
                                    ? `Inbox delivery ${d.delivery_id} acked, read ${d.read_at ? clock(d.read_at) : ""}`
                                    : `Read back from Relay ${d.read_at ? clock(d.read_at) : ""}`}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <Empty
              icon="message"
              title={
                !campaign
                  ? "No campaign selected"
                  : active.kind === "room"
                    ? "The research room is quiet"
                    : "No direct messages yet"
              }
              description={
                campaign
                  ? "Messages appear here once Agent Relay confirms the recipient read them. Handoffs between two agents arrive as direct messages."
                  : "Launch a campaign to bring the research team into the room."
              }
            />
          )}
        </div>
        <footer className="convo-foot">
          <span>
            <Icon name="lock" size={14} />
            Agents write here. You are reading the Relay transcript.
          </span>
          {!follow && !highlight && (
            <button
              className="text-button"
              onClick={() => {
                setFollow(true);
                const el = scroller.current;
                if (el) el.scrollTop = el.scrollHeight;
              }}
            >
              Latest
              <Icon name="down" size={14} />
            </button>
          )}
        </footer>
      </div>
    </section>
  );
}
