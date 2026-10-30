"use client";
/* Live product illustrations for /site. Each one replays real data from campaign
   forge-e84925eb (components/site/data.ts) on a timeline. Timelines run only while
   on screen and show their final frame under prefers-reduced-motion. Scene swaps use the
   measured figure transition: opacity 0 -> 1, translate 16px -> 0, blur 3px -> 0,
   500ms cubic-bezier(0.165, 0.84, 0.44, 1). */
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import {
  CRASH,
  DETECTORS,
  EXAMPLE,
  FLAGGED,
  KILLED_AFTER_STEP,
  LOSS,
  MESSAGES,
  RESULTS,
  ROLES,
  SCAN,
  SCAN_STATS,
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

function Scene({
  on,
  children,
  className = "",
}: {
  on: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`${s.scene} ${on ? s.sceneOn : ""} ${className}`}
      aria-hidden={!on}
    >
      {children}
    </div>
  );
}

function Squares({
  n,
  filled,
  lit,
}: {
  n: number;
  filled: number;
  lit: number;
}) {
  return (
    <div className={s.squares} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={`${s.square} ${i < filled ? s.squareBase : ""} ${
            i >= filled && i < filled + lit ? s.squareOn : ""
          }`}
        />
      ))}
    </div>
  );
}

function LossChart({
  upto,
  w = 520,
  h = 150,
}: {
  upto: number;
  w?: number;
  h?: number;
}) {
  const max = 1.45;
  const pts = LOSS.map((v, i) => [
    (i / (LOSS.length - 1)) * w,
    h - (v / max) * (h - 8) - 4,
  ]);
  const shown = pts.slice(0, Math.max(1, Math.round(upto)));
  const d = shown
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join("");
  const kx = (KILLED_AFTER_STEP / (LOSS.length - 1)) * w;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={s.chart} aria-hidden="true">
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1="0"
          x2={w}
          y1={h * f}
          y2={h * f}
          className={s.gridLine}
        />
      ))}
      <path d={d} className={s.lossLine} />
      {upto >= KILLED_AFTER_STEP && (
        <g className={s.fadeIn}>
          <line x1={kx} x2={kx} y1="0" y2={h} className={s.killLine} />
        </g>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Hero: a campaign replayed end to end                                 */
/* ------------------------------------------------------------------ */

// Scene cadence measured on the reference hero: a new state every ~5.05 s, 4 states per loop.
const HERO = { launch: 0, work: 5050, train: 10100, result: 15150, end: 20200 };
const SCENES = [
  { at: HERO.launch, label: "Launch" },
  { at: HERO.work, label: "Find mistakes" },
  { at: HERO.train, label: "Train" },
  { at: HERO.result, label: "Result" },
];
const CMD1 = "POST /production/scans   traffic.jsonl";
const CMD2 = `POST /campaigns   {"production_scan": "${SCAN}"}`;

export function HeroCampaign() {
  const { ref, t } = useTimeline(HERO.end);
  const scene = SCENES.reduce((acc, sc, i) => (t >= sc.at ? i : acc), 0);
  const tw = t - HERO.work;
  const tt = t - HERO.train;
  const tr = t - HERO.result;
  const step = Math.min(96, Math.max(1, (tt / 3000) * 96));
  const lit = Math.max(0, Math.min(9, Math.floor((tr - 600) / 110)));
  const litSealed = Math.max(0, Math.min(5, Math.floor((tr - 1800) / 140)));
  return (
    <div
      ref={ref}
      className={s.hero}
      role="img"
      aria-label="Replay of campaign forge-e84925eb: Forge scans 64 production answers and flags 62, five agents coordinate, the model trains for 96 steps, and held-out production failures go from 0 of 33 to 9 of 33."
    >
      <div className={s.heroBar}>
        <span className={s.heroId}>forge-e84925eb</span>
        <div className={s.steps}>
          {SCENES.map((sc, i) => (
            <span
              key={sc.label}
              className={`${s.stepTab} ${i === scene ? s.stepTabOn : ""} ${i < scene ? s.stepTabDone : ""}`}
            >
              {sc.label}
            </span>
          ))}
        </div>
      </div>
      <div className={s.heroBody}>
        <Scene on={scene === 0} className={s.terminal}>
          <div className={s.termLine}>
            <span className={s.prompt}>$</span>
            <span>{typed(CMD1, t, 300, 38)}</span>
          </div>
          {t > 1500 && (
            <div className={`${s.termOut} ${s.fadeIn}`}>
              64 answers read. 62 flagged for review.
            </div>
          )}
          {t > 1800 && (
            <div className={s.termLine}>
              <span className={s.prompt}>$</span>
              <span>{typed(CMD2, t, 1900, 42)}</span>
            </div>
          )}
          {t > 3400 && (
            <div className={`${s.termOut} ${s.fadeIn}`}>
              forge-e84925eb started. Five agents joined the research room.
            </div>
          )}
        </Scene>

        <Scene on={scene === 1} className={s.split}>
          <div className={s.col}>
            <div className={s.colHead}>
              <span>Flagged answers</span>
              <span className={s.mono}>
                {Math.min(62, Math.max(0, Math.floor(tw / 60)))} of 64
              </span>
            </div>
            <ul className={s.flagList}>
              {FLAGGED.map((f, i) =>
                tw > 200 + i * 420 ? (
                  <li key={f.id} className={`${s.flagRow} ${s.rise}`}>
                    <span className={s.flagQ}>{f.question}</span>
                    <span className={s.chips}>
                      {f.signals.map((sig) => (
                        <span key={sig} className={s.chip}>
                          {sig}
                        </span>
                      ))}
                    </span>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
          <div className={s.col}>
            <div className={s.colHead}>
              <span>Research room</span>
              <span className={s.mono}>Agent Relay</span>
            </div>
            <ul className={s.msgList}>
              {MESSAGES.slice(0, 3).map((m, i) =>
                tw > 900 + i * 1100 ? (
                  <li key={i} className={`${s.msgRow} ${s.rise}`}>
                    <Avatar role={m.from} />
                    <div>
                      <span className={s.msgWho}>
                        {ROLES[m.from].name}
                        <span className={s.route}>{m.route}</span>
                      </span>
                      <p className={s.msgText}>{m.text}</p>
                    </div>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        </Scene>

        <Scene on={scene === 2} className={s.trainScene}>
          <div className={s.colHead}>
            <span>Training exp-001 · targeted fine-tuning</span>
            <span className={s.mono}>Step {Math.round(step)} of 96</span>
          </div>
          <LossChart upto={step} />
          <div className={s.trainFoot}>
            <span>Training loss, real values from the run</span>
            {step >= KILLED_AFTER_STEP && (
              <span className={`${s.fadeIn} ${s.killNote}`}>
                After step 76: runtime force-stopped, back in {CRASH.back} s,
                resumed
              </span>
            )}
          </div>
        </Scene>

        <Scene on={scene === 3} className={s.resultScene}>
          <div className={s.resultBlock}>
            <span className={s.resultLabel}>
              Held-out production failures now answered correctly
            </span>
            <div className={s.bigNum}>
              <span className={s.numSwap} key={tr > 600 ? "a" : "b"}>
                {tr > 600 ? Math.max(0, lit) : RESULTS.production.before}
              </span>
              <span className={s.of}> of 33</span>
            </div>
            <Squares n={33} filled={0} lit={lit} />
          </div>
          <div className={s.resultBlock}>
            <span className={s.resultLabel}>Sealed final test</span>
            <div className={s.bigNumSm}>
              {RESULTS.sealed.before + litSealed}
              <span className={s.of}> of 24</span>
            </div>
            <Squares n={24} filled={1} lit={litSealed} />
          </div>
        </Scene>
      </div>
    </div>
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
        <span className={s.kicker}>
          Final test question · GSM8K {EXAMPLE.id}
        </span>
        <p>{EXAMPLE.question}</p>
      </div>
      <div className={s.exampleCols}>
        {[
          {
            label: "Before Forge",
            model: "Qwen2.5-0.5B-Instruct",
            text: before,
            full: EXAMPLE.before,
            done: doneBefore,
            foot: "Ends at the 256-token limit",
          },
          {
            label: "After Forge",
            model: "Checkpoint exp-001",
            text: after,
            full: EXAMPLE.after,
            done: doneAfter,
            foot: "Final answer: 500",
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
        <span>
          Both answers exactly as the models wrote them in campaign
          forge-e84925eb.
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Production: detector audit                                           */
/* ------------------------------------------------------------------ */

export function AuditCard() {
  const { ref, t } = useTimeline(2400, { loop: false });
  return (
    <div ref={ref} className={s.card}>
      <div className={s.cardHead}>
        <span>Scan {SCAN}</span>
        <span className={s.mono}>{SCAN_STATS.traces} answers</span>
      </div>
      <div className={s.auditNums}>
        <div>
          <span className={s.kicker}>Precision</span>
          <strong>{SCAN_STATS.precision}</strong>
          <p>62 of 62 flagged answers were truly wrong</p>
        </div>
        <div>
          <span className={s.kicker}>Recall</span>
          <strong>{SCAN_STATS.recall}</strong>
          <p>62 of 63 wrong answers were flagged</p>
        </div>
      </div>
      <ul className={s.detectors}>
        {DETECTORS.map((d, i) => (
          <li key={d.name}>
            <div className={s.detRow}>
              <span>{d.name}</span>
              <span className={s.mono}>{d.count}</span>
            </div>
            <span className={s.bar}>
              <span
                className={s.barFill}
                style={{
                  transform: `scaleX(${t > 200 + i * 80 ? d.count / SCAN_STATS.traces : 0})`,
                  transitionDelay: `${i * 80}ms`,
                }}
              />
            </span>
          </li>
        ))}
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
            <li
              key={`${m.time}-${m.category}`}
              className={`${s.flowRow} ${s.rise}`}
            >
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
                {m.receipt} · {m.time} UTC
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Durable actors: crash and recovery                                   */
/* ------------------------------------------------------------------ */

const SPAN = 30; // seconds on the axis
const PLAY = 5200; // ms to sweep the axis
export function RecoveryTimeline() {
  const { ref, t } = useTimeline(PLAY + 3600);
  const sec = Math.min(SPAN, (t / PLAY) * SPAN);
  const pct = (v: number) => `${(v / SPAN) * 100}%`;
  const back = sec >= CRASH.back;
  const resumed = sec >= CRASH.back + CRASH.resumed;
  const cells = [
    {
      k: "Force-stopped",
      v: `pid ${CRASH.killedPid}`,
      on: true,
      note: `SIGKILL at ${CRASH.killedAt} UTC`,
    },
    {
      k: "Process restarted",
      v: `${CRASH.processBack} s`,
      on: sec >= CRASH.processBack,
      note: `New pid ${CRASH.restartedPid}`,
    },
    {
      k: "Runtime back",
      v: `${CRASH.back} s`,
      on: back,
      note: `Writes held ${CRASH.fenced} s until the old lease ended`,
    },
    {
      k: "Training resumed",
      v: `+${CRASH.resumed} s`,
      on: resumed,
      note: `Same request ID, ${CRASH.attempts} attempts`,
    },
  ];
  return (
    <div ref={ref} className={s.card}>
      <div className={s.cardHead}>
        <span>Crash test during exp-001 training</span>
        <span className={s.mono}>{sec.toFixed(1)} s</span>
      </div>
      <div className={s.timeline}>
        <div className={s.track}>
          <span
            className={s.segKill}
            style={{ left: 0, width: pct(Math.min(sec, CRASH.processBack)) }}
          />
          {sec > CRASH.processBack && (
            <span
              className={s.segHold}
              style={{
                left: pct(CRASH.processBack),
                width: pct(Math.min(sec, CRASH.back) - CRASH.processBack),
              }}
            />
          )}
          {back && (
            <span
              className={s.segBack}
              style={{ left: pct(CRASH.back), width: pct(sec - CRASH.back) }}
            />
          )}
          <span className={s.playhead} style={{ left: pct(sec) }} />
        </div>
        <div className={s.axis}>
          <span>0 s</span>
          <span>10 s</span>
          <span>20 s</span>
          <span>30 s</span>
        </div>
      </div>
      <div className={s.cells}>
        {cells.map((c) => (
          <div key={c.k} className={`${s.cell} ${c.on ? s.cellOn : ""}`}>
            <span className={s.kicker}>{c.k}</span>
            <strong className={s.mono}>{c.v}</strong>
            <p>{c.note}</p>
          </div>
        ))}
      </div>
      <ul className={s.actors}>
        {CRASH.actors.map((a, i) => (
          <li
            key={a}
            className={back && sec >= CRASH.back + 0.2 * i ? s.actorOn : ""}
          >
            <Icon name="check" size={14} />
            <span className={s.mono}>{a}</span>
            <span>identical</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Code that types itself                                               */
/* ------------------------------------------------------------------ */

export function TypedCode({ title, code }: { title: string; code: string }) {
  const { ref, t } = useTimeline((code.length / 70) * 1000 + 400, {
    loop: false,
  });
  const shown = typed(code, t, 200, 70);
  const done = shown.length >= code.length;
  return (
    <div ref={ref} className={s.code}>
      <div className={s.cardHead}>
        <span>{title}</span>
        <span className={s.mono}>TypeScript</span>
      </div>
      <div className={s.transcriptWrap}>
        <pre className={`${s.codeBody} ${s.ghost}`} aria-hidden="true">
          {code}
        </pre>
        <pre className={s.codeBody} aria-label={title}>
          {shown}
          {!done && <span className={s.caret} aria-hidden="true" />}
        </pre>
      </div>
    </div>
  );
}
