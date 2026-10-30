"use client";
/* Live product illustrations for /site, built from one recorded Forge run
   (components/site/data.ts) and shown in plain words. Timelines run only while
   on screen and show their final frame under prefers-reduced-motion. Scene swaps use the
   measured figure transition: opacity 0 -> 1, translate 16px -> 0, blur 3px -> 0,
   500ms cubic-bezier(0.165, 0.84, 0.44, 1). */
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import {
  EXAMPLE,
  FLAGGED,
  MESSAGES,
  ROLES,
  type Message,
  type Role,
} from "./data";
import s from "./live.module.css";

const FINAL = Number.MAX_SAFE_INTEGER;

/** Elapsed ms of a looping (or one-shot) timeline that only advances while visible. */
function useTimeline(
  length: number,
  {
    loop = true,
    threshold = 0.35,
  }: { loop?: boolean; threshold?: number } = {},
) {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setT(FINAL));
      return () => cancelAnimationFrame(id);
    }
    let visible = false;
    let raf = 0;
    let last = 0;
    let elapsed = 0;
    let painted = 0;
    const frame = (now: number) => {
      if (!visible) return;
      elapsed += last ? Math.min(now - last, 64) : 0;
      last = now;
      if (elapsed >= length) {
        if (loop) elapsed = 0;
        else {
          setT(length);
          return;
        }
      }
      if (now - painted > 30) {
        painted = now;
        setT(elapsed);
      }
      raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
        cancelAnimationFrame(raf);
        if (visible) {
          last = 0;
          raf = requestAnimationFrame(frame);
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [length, loop, threshold, run]);
  return { ref, t, replay: () => setRun((n) => n + 1) };
}

const typed = (text: string, t: number, start: number, cps: number) =>
  text.slice(0, Math.max(0, Math.floor(((t - start) / 1000) * cps)));

function Avatar({ role, size = 28 }: { role: Role; size?: number }) {
  return (
    <span
      className={s.avatar}
      style={{ width: size, height: size, fontSize: size * 0.39 }}
      aria-hidden="true"
    >
      {ROLES[role].initials}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Before / after: the burrito question, typed                          */
/* ------------------------------------------------------------------ */

const CPS = 95;
export function TypedExample() {
  const total = (EXAMPLE.before.length / CPS) * 1000 + 600;
  const { ref, t, replay } = useTimeline(total, {
    loop: false,
    threshold: 0.4,
  });
  const before = typed(EXAMPLE.before, t, 300, CPS);
  const after = typed(EXAMPLE.after, t, 300, CPS * 0.55);
  const doneBefore = before.length >= EXAMPLE.before.length;
  const doneAfter = after.length >= EXAMPLE.after.length;
  return (
    <div ref={ref} className={s.example}>
      <div className={s.exampleQ}>
        <span className={s.kicker}>A question from the final test</span>
        <p>{EXAMPLE.question}</p>
      </div>
      <div className={s.exampleCols}>
        {[
          {
            label: "Before Forge",
            model: "The original model",
            text: before,
            full: EXAMPLE.before,
            done: doneBefore,
            foot: "Stops before giving an answer",
          },
          {
            label: "After Forge",
            model: "Trained by Forge",
            text: after,
            full: EXAMPLE.after,
            done: doneAfter,
            foot: "Answers 500",
          },
        ].map((c) => (
          <div className={s.exampleCol} key={c.label}>
            <div className={s.exampleHead}>
              <strong>{c.label}</strong>
              <span>{c.model}</span>
            </div>
            <div className={s.transcriptWrap}>
              {/* The full text reserves the final height so nothing below jumps. */}
              <pre className={`${s.transcript} ${s.ghost}`} aria-hidden="true">
                {c.full}
              </pre>
              <pre
                className={s.transcript}
                aria-label={`${c.label} transcript`}
              >
                {c.text}
                {!c.done && <span className={s.caret} aria-hidden="true" />}
              </pre>
            </div>
            <div className={`${s.exampleFoot} ${c.done ? s.footOn : ""}`}>
              {c.foot}
            </div>
          </div>
        ))}
      </div>
      <div className={s.exampleActions}>
        <button
          type="button"
          className={s.replay}
          onClick={replay}
          disabled={!doneBefore}
        >
          <Icon name="refresh" size={14} />
          Replay
        </button>
        <span>Both answers exactly as the models wrote them.</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Finding mistakes: answers flagged one by one                         */
/* ------------------------------------------------------------------ */

export function FlagList() {
  const { ref, t } = useTimeline(FLAGGED.length * 650 + 3200);
  return (
    <div ref={ref} className={s.card}>
      <div className={s.cardHead}>
        <span>Answers Forge flagged</span>
        <span>From your agent&apos;s traffic</span>
      </div>
      <ul className={s.flagList}>
        {FLAGGED.map((f, i) =>
          t > 300 + i * 650 ? (
            <li key={f.question} className={`${s.flagRow} ${s.rise}`}>
              <span className={s.flagQ}>{f.question}</span>
              <span className={s.chips}>
                {f.tags.map((tag) => (
                  <span key={tag} className={s.chip}>
                    {tag}
                  </span>
                ))}
              </span>
            </li>
          ) : null,
        )}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agents: message flow                                                 */
/* ------------------------------------------------------------------ */

const FLOW_STEP = 2300;
export function AgentFlow() {
  const { ref, t } = useTimeline(MESSAGES.length * FLOW_STEP + 2600);
  const shown = Math.min(MESSAGES.length, Math.floor(t / FLOW_STEP) + 1);
  const current = MESSAGES[shown - 1];
  const inStep = t - (shown - 1) * FLOW_STEP;
  const roles = Object.keys(ROLES) as Role[];
  const active = (r: Role) =>
    current.from === r ||
    current.to === r ||
    (current.to === "room" && inStep > 700);
  const visible = MESSAGES.slice(Math.max(0, shown - 3), shown);
  return (
    <div ref={ref} className={s.card}>
      <div className={s.roles}>
        {roles.map((r) => (
          <div
            key={r}
            className={`${s.role} ${active(r) ? s.roleOn : ""} ${current.from === r ? s.roleFrom : ""}`}
          >
            <Avatar role={r} size={36} />
            <span>{ROLES[r].name.split(" ").slice(-1)[0]}</span>
          </div>
        ))}
      </div>
      <ul className={s.flow}>
        {visible.map((m: Message, i) => {
          const isNew = i === visible.length - 1;
          return (
            <li key={m.text} className={`${s.flowRow} ${s.rise}`}>
              <div className={s.flowMeta}>
                <Avatar role={m.from} size={24} />
                <span className={s.flowWho}>
                  {ROLES[m.from].name}
                  <Icon name="arrow" size={12} />
                  {m.to === "room" ? "Research room" : ROLES[m.to].name}
                </span>
                <span className={s.route}>{m.route}</span>
              </div>
              <p className={s.flowText}>{m.text}</p>
              <span
                className={`${s.receipt} ${!isNew || inStep > 1100 ? s.receiptOn : ""}`}
              >
                <Icon name="check" size={12} />
                {m.receipt}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Memory: stopped on purpose, back exactly as it was                  */
/* ------------------------------------------------------------------ */

// Proportions follow the recorded crash test: restart, records held, back, resume.
const STEPS = [
  {
    at: 0,
    title: "Stopped on purpose",
    note: "We force-stopped it mid-training",
  },
  { at: 0.07, title: "Restarting", note: "The runtime comes back up" },
  { at: 0.93, title: "Records restored", note: "Everything exactly as it was" },
  { at: 0.97, title: "Training resumes", note: "From the very same step" },
];
const RECORDS = ["Goal and budget", "Experiments", "Approvals", "Saved files"];
const SWEEP = 5200;
export function RecoveryTimeline() {
  const { ref, t } = useTimeline(SWEEP + 3600);
  const p = Math.min(1, t / SWEEP);
  const pct = (v: number) => `${v * 100}%`;
  const back = p >= STEPS[2].at;
  return (
    <div ref={ref} className={s.card}>
      <div className={s.cardHead}>
        <span>A test we ran during training</span>
        <span>{back ? "Recovered" : "Recovering"}</span>
      </div>
      <div className={s.timeline}>
        <div className={s.track}>
          <span
            className={s.segKill}
            style={{ left: 0, width: pct(Math.min(p, STEPS[1].at)) }}
          />
          {p > STEPS[1].at && (
            <span
              className={s.segHold}
              style={{
                left: pct(STEPS[1].at),
                width: pct(Math.min(p, STEPS[2].at) - STEPS[1].at),
              }}
            />
          )}
          {back && (
            <span
              className={s.segBack}
              style={{ left: pct(STEPS[2].at), width: pct(p - STEPS[2].at) }}
            />
          )}
          <span className={s.playhead} style={{ left: pct(p) }} />
        </div>
      </div>
      <div className={s.cells}>
        {STEPS.map((c) => (
          <div
            key={c.title}
            className={`${s.cell} ${p >= c.at ? s.cellOn : ""}`}
          >
            <strong className={s.cellTitle}>{c.title}</strong>
            <p>{c.note}</p>
          </div>
        ))}
      </div>
      <ul className={s.actors}>
        {RECORDS.map((a, i) => (
          <li
            key={a}
            className={back && p >= STEPS[2].at + 0.01 * i ? s.actorOn : ""}
          >
            <Icon name="check" size={14} />
            <span>{a}</span>
            <span>restored</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Proof: train, test, approve, download                                */
/* ------------------------------------------------------------------ */

const SHIP = [
  { title: "Train", note: "On the answers it missed" },
  { title: "Test", note: "On brand-new questions" },
  { title: "Approve", note: "The governance council signs off" },
  { title: "Download", note: "Your model, your report, every step" },
];
export function ShipSteps() {
  const { ref, t } = useTimeline(SHIP.length * 900 + 3000);
  return (
    <div ref={ref} className={s.card}>
      <div className={s.cardHead}>
        <span>From mistakes to your model</span>
      </div>
      <ol className={s.ship}>
        {SHIP.map((st, i) => {
          const done = t > 400 + i * 900;
          return (
            <li key={st.title} className={done ? s.shipOn : ""}>
              <span className={s.tick}>
                <Icon name={done ? "check" : "clock"} size={14} />
              </span>
              <span>
                <strong>{st.title}</strong>
                <span>{st.note}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
