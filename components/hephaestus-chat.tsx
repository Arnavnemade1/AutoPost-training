"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import { api } from "@/lib/packs";

type Line = {
  id: string;
  sender: "you" | "hephaestus";
  text: string;
  at: string;
};
type Desk = {
  messages: Line[];
  thinking: boolean;
  model: { connected: boolean; provider: string | null };
};

/** The private conversation in Agent chat: just the lab's owner and Hephaestus. */
export function HephaestusChat({ onBack }: { onBack: () => void }) {
  const [desk, setDesk] = useState<Desk | null>(null),
    [draft, setDraft] = useState(""),
    [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setDesk(await api<Desk>("hephaestus/messages"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hephaestus is unavailable.");
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 2000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const count = desk?.messages.length ?? 0;
  const thinking = desk?.thinking ?? false;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, thinking]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setError("");
    try {
      await api("hephaestus/messages", { text });
      await load();
    } catch (failure) {
      setDraft(text);
      setError(failure instanceof Error ? failure.message : "Not sent.");
    }
  }

  return (
    <div className="convo-pane">
      <header className="convo-head">
        <div className="convo-head-start">
          <button
            className="convo-back"
            aria-label="Back to conversations"
            onClick={onBack}
          >
            <Icon name="chevron" size={22} />
          </button>
        </div>
        <div className="convo-head-center">
          <span className="avatar-hephaestus" aria-hidden="true">
            HE
          </span>
          <h3>Hephaestus</h3>
          <p className="convo-head-sub">Just you · admin of the agent chat</p>
        </div>
        <div className="convo-head-end" />
      </header>
      {desk && !desk.model.connected && (
        <p className="hephaestus-note">
          No model connected, so it only understands commands. Say help to see
          them.
        </p>
      )}
      <div className="convo-scroll" ref={scroller} tabIndex={0}>
        <div className="bubble-list" aria-live="polite">
          {desk?.messages.map((m) => (
            <div
              key={m.id}
              className={`bubble-row start end ${m.sender === "you" ? "mine" : ""}`}
            >
              <div className="bubble-col">
                <div className="bubble-wrap">
                  <div className="bubble">
                    <span className="bubble-text">{m.text}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {thinking && (
            <div className="bubble-row start end">
              <div className="bubble-col">
                <div className="bubble-wrap">
                  <div className="bubble pending">
                    <span className="bubble-text">Working on it…</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        {desk && !count && !thinking && (
          <p className="hephaestus-note">
            Tell it what to train, or say help. It can start and stop runs,
            direct the research team and read their conversations. It can&apos;t
            override governance, budgets or test data.
          </p>
        )}
      </div>
      <footer className="composer">
        {error && <p className="hephaestus-note">{error}</p>}
        <form className="composer-field" onSubmit={send}>
          <input
            className="composer-input"
            aria-label="Message Hephaestus"
            placeholder="Message Hephaestus"
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="composer-send"
            disabled={!draft.trim()}
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        </form>
      </footer>
    </div>
  );
}
