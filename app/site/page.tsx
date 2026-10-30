/* eslint-disable @next/next/no-img-element -- static captures with fixed intrinsic sizes */
import { Icon, ForgeMark } from "@/components/icon";
import { SiteHeader } from "@/components/site/header";
import {
  BuiltWith,
  CtaGrid,
  HeroGrid,
  LoopVideo,
  ProductNav,
  QuoteCarousel,
  type Quote,
} from "@/components/site/motion";
import {
  JournalDrawing,
  TeamDrawing,
  TracesDrawing,
} from "@/components/site/drawings";
import s from "@/components/site/site.module.css";

// Every number on this page comes from campaign forge-e84925eb (NVIDIA H100 80GB HBM3):
// artifacts/forge-e84925eb/report.json, events.jsonl and data/chaos/incidents.json.
const SIDE = [
  { id: "production", label: "Production", icon: "production" },
  { id: "agents", label: "Agents", icon: "chat" },
  { id: "durable", label: "Durable actors", icon: "terse" },
  { id: "training", label: "Training", icon: "chip" },
];

const BUILT_WITH = [
  "Qwen2.5-0.5B-Instruct",
  "NVIDIA H100 80GB HBM3",
  "Agent Relay",
  "Terse durable actors",
  "LoRA fine-tuning",
  "PyTorch",
  "GSM8K",
  "EleutherAI evaluation harness",
];

const QUOTES: Quote[] = [
  {
    initials: "DR",
    from: "Data researcher",
    to: "Research director",
    category: "PRODUCTION_FAILURES_TRIAGED",
    time: "00:25:13",
    text: "62 of 64 production answers flagged (1 arithmetic slip, 62 missing final answer, 38 truncated). 28 labeled failures join training; 33 are held out to measure the fix.",
  },
  {
    initials: "TE",
    from: "Training engineer",
    to: "Experiment evaluator",
    category: "TRAINING_COMPLETED",
    time: "00:29:22",
    text: "exp-001 saved. Weights changed: True. SHA-256 15e585f199e9cec5. Reload independently for evaluation.",
  },
  {
    initials: "EV",
    from: "Experiment evaluator",
    to: "Research director",
    category: "EVALUATION_COMPLETED",
    time: "00:31:34",
    text: "exp-001: 8/24 development answers correct. Review approved. Regression change +25.0 pp. Held-out production failures now correct: 9/33 (baseline 0/33).",
  },
  {
    initials: "GC",
    from: "Governance council",
    to: "Training engineer",
    category: "CHECKPOINT_VERDICT",
    time: "00:31:34",
    text: "Approved for promotion. Integrity, regression and provenance checks passed for exp-001.",
  },
  {
    initials: "RD",
    from: "Research director",
    to: "Governance council",
    category: "CAMPAIGN_COMPLETED",
    time: "00:36:46",
    text: "Final evaluation complete. Validated improvement: the 95% paired interval is above zero. All sample-level evidence preserved.",
  },
];

const ACTORS = [
  ["ResearchCampaign", "Goal, budget and the best checkpoint"],
  ["Experiment", "Settings, worker leases and results"],
  ["Governance", "Signed approval for each checkpoint"],
  ["ArtifactRegistry", "Checksums and where every file lives"],
  ["RLWorld", "Math worlds that score each answer"],
  ["ResearchLedger", "Every diagnosis, idea and decision"],
];

const CODE_LINES: { k?: string; v: string; t?: "str" | "num" }[][] = [
  [{ v: "await fetch(" }, { v: '"/api/lab/campaigns"', t: "str" }, { v: ", {" }],
  [{ v: "  method: " }, { v: '"POST"', t: "str" }, { v: "," }],
  [{ v: "  body: JSON.stringify({" }],
  [{ k: "    production_scan: " }, { v: '"scan-b1b36ecf"', t: "str" }, { v: "," }],
  [{ k: "    strategies: " }, { v: '["targeted_sft", "broad_sft"]', t: "str" }, { v: "," }],
  [{ k: "    max_experiments: " }, { v: "2", t: "num" }, { v: "," }],
  [{ k: "    train_steps: " }, { v: "96", t: "num" }, { v: "," }],
  [{ k: "    dev_samples: " }, { v: "24", t: "num" }, { v: "," }],
  [{ k: "    final_samples: " }, { v: "24", t: "num" }, { v: "," }],
  [{ k: "    max_seconds: " }, { v: "5400", t: "num" }, { v: "," }],
  [{ v: "  })," }],
  [{ v: "});" }],
];

function Eyebrow({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <span className={s.eyebrow}>
      <span className={s.eyebrowIcon}>
        <Icon name={icon} size={12} />
      </span>
      {children}
    </span>
  );
}

function Feature({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className={s.feature}>
      <h4>
        <Icon name={icon} size={16} />
        {title}
      </h4>
      <p className={s.small}>{children}</p>
    </div>
  );
}

function Scale({ before, after, n }: { before: number; after: number; n: number }) {
  const max = 0.5;
  const x = (v: number) => `${(v / n / max) * 100}%`;
  return (
    <div className={s.scale} aria-hidden="true">
      <div className={s.scaleTrack} />
      <div className={s.scaleSpan} style={{ left: x(before), width: `calc(${x(after)} - ${x(before)})` }} />
      <span className={`${s.dot} ${s.dotBefore}`} style={{ left: x(before) }} />
      <span className={`${s.dot} ${s.dotAfter}`} style={{ left: x(after) }} />
      <span className={s.dotLabel} style={{ left: x(before) }}>
        {before}/{n}
      </span>
      <span className={s.dotLabel} style={{ left: x(after) }}>
        {after}/{n}
      </span>
      <div className={s.scaleTicks}>
        <span>0%</span>
        <span>25%</span>
        <span>50%</span>
      </div>
    </div>
  );
}

export default function SitePage() {
  return (
    <div className={s.root} id="top">
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className={s.hero}>
          <HeroGrid className={s.heroGrid} />
          <div className={s.container}>
            <div className={s.heroText}>
              <h1 className={s.h1}>
                <span className={s.soft}>Post-training, </span>
                fully automated
              </h1>
              <p className={`${s.lead} ${s.heroSub}`}>
                Turn your agent&apos;s production traffic into a private model, fine-tuned to be
                the best at your own tasks. You own the weights and the costs.
              </p>
              <div className={s.ctaRow}>
                <a href="/" className={s.btn}>
                  Open the lab
                </a>
                <a href="#results" className={s.btnGhost}>
                  See the results
                </a>
              </div>
            </div>
            <figure className={s.heroShot}>
              <div className={s.frame}>
                <LoopVideo
                  name="hero-chat"
                  width={1600}
                  height={900}
                  label="Forge Agent chat filling in as five agents run a training campaign"
                />
              </div>
              <figcaption className={s.caption}>
                Agent chat during campaign forge-e84925eb, shown 48 times faster.
              </figcaption>
            </figure>
            <div className={s.strip}>
              <p className={s.stripLabel}>Built with</p>
              <span className={s.stripDivider} aria-hidden="true" />
              <div className={s.stripLoop}>
                <BuiltWith items={BUILT_WITH} />
              </div>
            </div>
          </div>
        </section>

        {/* Product */}
        <section className={s.section} id="product">
          <div className={s.container}>
            <div className={s.sectionHead}>
              <Eyebrow icon="overview">Product</Eyebrow>
              <h2 className={s.h2}>Your traffic in, your own model out</h2>
            </div>
            <div className={`${s.grid} ${s.product}`}>
              <ProductNav items={SIDE} />
              <div className={s.blocks}>
                <article className={s.block} id="production">
                  <div className={s.blockText}>
                    <h3 className={s.h3}>Find what your agent gets wrong</h3>
                    <p className={`${s.lead} ${s.blockLead}`}>
                      Upload your agent&apos;s real answers. Forge spots the wrong ones on its own
                      and checks its accuracy against reviewer labels.
                    </p>
                    <div className={s.features}>
                      <Feature icon="search" title="Four detectors">
                        Miscalculations, missing final answers, cut-off replies and user
                        corrections.
                      </Feature>
                      <Feature icon="target" title="Measured accuracy">
                        100% precision and 98.4% recall on the recorded scan. All 62 flagged
                        answers were truly wrong.
                      </Feature>
                      <Feature icon="lock" title="Test questions stay sealed">
                        Traffic that matches a sealed test question is set aside before the
                        scan begins.
                      </Feature>
                    </div>
                    <a href="/" className={`${s.btn} ${s.blockButton}`}>
                      Open the lab
                    </a>
                  </div>
                  <div className={s.visual}>
                    <figure className={s.visualInner}>
                      <div className={s.frame}>
                        <img
                          src="/site/audit.webp"
                          width={562}
                          height={376}
                          alt="Detector audit: precision 100.0%, recall 98.4%, 62 of 62 flagged answers were actually wrong."
                        />
                      </div>
                      <figcaption className={s.visualCap}>
                        Detector audit for scan-b1b36ecf: 64 answers, 62 flagged.
                      </figcaption>
                    </figure>
                  </div>
                </article>

                <article className={s.block} id="agents">
                  <div className={s.blockText}>
                    <h3 className={s.h3}>Five agents, one research room</h3>
                    <p className={`${s.lead} ${s.blockLead}`}>
                      One click starts a data researcher, director, trainer, evaluator and
                      governance council. They coordinate over Agent Relay.
                    </p>
                    <div className={s.features}>
                      <Feature icon="message" title="Direct messages">
                        Each handoff lands in one agent&apos;s inbox, and work starts once that
                        agent confirms it.
                      </Feature>
                      <Feature icon="chat" title="One research room">
                        Plans, checkpoints and the final result are posted where every agent
                        can read them.
                      </Feature>
                      <Feature icon="governance" title="Verdicts in threads">
                        Governance answers under each checkpoint post and adds a reaction.
                      </Feature>
                      <Feature icon="check" title="Read receipts">
                        Every message shows who received it and when.
                      </Feature>
                    </div>
                    <a href="/" className={`${s.btn} ${s.blockButton}`}>
                      Open Agent chat
                    </a>
                  </div>
                  <div className={s.visual}>
                    <figure className={s.visualInner}>
                      <div className={s.frame}>
                        <LoopVideo
                          name="relay"
                          width={1280}
                          height={619}
                          label="Agent Relay messages arriving in Forge's Agent chat"
                        />
                      </div>
                      <figcaption className={s.visualCap}>
                        Agent chat as messages arrive, shown 2 times faster.
                      </figcaption>
                    </figure>
                  </div>
                </article>

                <article className={s.block} id="durable">
                  <div className={s.blockText}>
                    <h3 className={s.h3}>A record that survives anything</h3>
                    <p className={`${s.lead} ${s.blockLead}`}>
                      Every budget, lease, review and checkpoint lives in signed, journaled
                      Terse durable actors.
                    </p>
                    <div className={s.features}>
                      <Feature icon="terse" title="Six durable actors">
                        ResearchCampaign, Experiment, Governance, ArtifactRegistry, RLWorld and
                        ResearchLedger.
                      </Feature>
                      <Feature icon="refresh" title="Back in 28.3 seconds">
                        We force-stopped the runtime mid-training. It returned with 4 of 4
                        actors exactly as they were.
                      </Feature>
                      <Feature icon="clock" title="Every second counted once">
                        Training picked up 0.6 seconds later under its original request ID.
                        198.7 seconds settled, once.
                      </Feature>
                    </div>
                    <a href="/" className={`${s.btn} ${s.blockButton}`}>
                      Open Durable actors
                    </a>
                  </div>
                  <div className={s.visual}>
                    <figure className={s.visualInner}>
                      <div className={s.frame}>
                        <LoopVideo
                          name="crash"
                          width={1280}
                          height={451}
                          label="Crash test timeline: SIGKILL, runtime back in 28.3 seconds, 4 of 4 actors restored, campaign resumed"
                        />
                      </div>
                      <figcaption className={s.visualCap}>
                        The crash test during the recorded run, shown 2 times faster.
                      </figcaption>
                    </figure>
                  </div>
                </article>

                <article className={s.block} id="training">
                  <div className={s.blockText}>
                    <h3 className={s.h3}>Train, test, approve, download</h3>
                    <p className={`${s.lead} ${s.blockLead}`}>
                      Forge trains on an NVIDIA H100 GPU, tests on questions held back for the
                      purpose, and hands you the weights.
                    </p>
                    <div className={s.features}>
                      <Feature icon="production" title="Held-out failures">
                        Half of the labeled failures are kept for testing. 0 of 33 became 9 of
                        33.
                      </Feature>
                      <Feature icon="lock" title="A sealed final test">
                        The winning checkpoint is locked before the sealed questions open. 1 of
                        24 became 6 of 24.
                      </Feature>
                      <Feature icon="governance" title="Governance decides">
                        The council promotes the checkpoint with the best development score.
                        Here, exp-001.
                      </Feature>
                      <Feature icon="download" title="Your weights">
                        Download the checkpoint, the report and the full research trace.
                      </Feature>
                    </div>
                    <a href="#results" className={`${s.btn} ${s.blockButton}`}>
                      See the results
                    </a>
                  </div>
                  <div className={s.visual}>
                    <div className={`${s.visualInner} ${s.code}`}>
                      <div className={s.codeHead}>
                        <span>Start a campaign from production failures</span>
                        <span>TypeScript</span>
                      </div>
                      <pre className={s.codeBody}>
                        <code>
                          {CODE_LINES.map((line, n) => (
                            <span key={n}>
                              {line.map((p, m) =>
                                p.k ? (
                                  <span key={m} className={s.tokKey}>
                                    {p.k}
                                  </span>
                                ) : (
                                  <span
                                    key={m}
                                    className={
                                      p.t === "str" ? s.tokStr : p.t === "num" ? s.tokNum : undefined
                                    }
                                  >
                                    {p.v}
                                  </span>
                                ),
                              )}
                              {"\n"}
                            </span>
                          ))}
                        </code>
                      </pre>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className={`${s.section} ${s.band}`} id="platform">
          <div className={s.container}>
            <div className={`${s.sectionHead} ${s.narrow}`}>
              <Eyebrow icon="environments">How it works</Eyebrow>
              <h2 className={s.h2}>Every step leaves evidence you can check</h2>
              <a href="#results" className={`${s.btn} ${s.headButton}`}>
                See the results
              </a>
            </div>
            <div className={s.cols3}>
              <div className={s.col}>
                <span className={s.colNum}>1</span>
                <div className={s.drawing}>
                  <TracesDrawing />
                </div>
                <h3 className={s.h3}>Learns from your own traffic</h3>
                <p className={s.body}>
                  Forge reads your agent&apos;s real answers and flags the wrong ones by itself:
                  a missing final answer, a cut-off reply, a miscalculation or a user&apos;s
                  correction.
                </p>
              </div>
              <div className={s.col}>
                <span className={s.colNum}>2</span>
                <div className={s.drawing}>
                  <TeamDrawing />
                </div>
                <h3 className={s.h3}>A team that checks its own work</h3>
                <p className={s.body}>
                  The trainer hands each checkpoint to the evaluator. The governance council
                  reviews every checkpoint against a fixed policy before promotion.
                </p>
              </div>
              <div className={s.col}>
                <span className={s.colNum}>3</span>
                <div className={s.drawing}>
                  <JournalDrawing />
                </div>
                <h3 className={s.h3}>A signed record of every step</h3>
                <p className={s.body}>
                  Each change to a campaign carries a signature and is saved to a journal, so
                  the whole run can be replayed and checked.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Results */}
        <section className={`${s.section} ${s.ruleTop}`} id="results">
          <div className={s.container}>
            <div className={`${s.sectionHead} ${s.narrow}`}>
              <Eyebrow icon="results">Results</Eyebrow>
              <h2 className={s.h2}>Measured on questions it had never seen</h2>
              <a href="/" className={`${s.btn} ${s.headButton}`}>
                Open the results
              </a>
            </div>
            <div className={s.resultsPanel}>
              <div className={s.resultRow}>
                <div className={s.resultLabel}>
                  <h3>Held-out production failures</h3>
                  <p className={s.small}>
                    Real failures from the traffic, kept out of training to measure the fix.
                  </p>
                </div>
                <Scale before={0} after={9} n={33} />
                <div className={s.gain}>
                  <div className={s.gainNum}>
                    +27.3<small>pp</small>
                  </div>
                  <p className={s.small}>95% interval +12.1 to +42.4. Validated.</p>
                </div>
              </div>
              <div className={s.resultRow}>
                <div className={s.resultLabel}>
                  <h3>Sealed final test</h3>
                  <p className={s.small}>
                    24 grade-school math questions, opened once after the checkpoint was locked.
                  </p>
                </div>
                <Scale before={1} after={6} n={24} />
                <div className={s.gain}>
                  <div className={s.gainNum}>
                    +20.8<small>pp</small>
                  </div>
                  <p className={s.small}>95% interval +4.2 to +37.5. Validated.</p>
                </div>
              </div>
            </div>
            <p className={s.resultsMeta}>
              Campaign forge-e84925eb · Qwen2.5-0.5B-Instruct · NVIDIA H100 80GB HBM3 · about 12
              minutes · paired bootstrap 95% intervals
            </p>
            <div className={s.cols4}>
              <div className={s.col4}>
                <h3 className={s.h3sm}>
                  <Icon name="check" size={16} />
                  Every right answer kept
                </h3>
                <p className={s.body}>
                  All held-out and sealed questions the original model got right, it still
                  gets right.
                </p>
              </div>
              <div className={s.col4}>
                <h3 className={s.h3sm}>
                  <Icon name="experiments" size={16} />
                  Chosen on practice questions
                </h3>
                <p className={s.body}>
                  The checkpoint is picked from development results, keeping the test scores a
                  fair measure.
                </p>
              </div>
              <div className={s.col4}>
                <h3 className={s.h3sm}>
                  <Icon name="lock" size={16} />
                  One sealed attempt
                </h3>
                <p className={s.body}>Each model answers the sealed test exactly once.</p>
              </div>
              <div className={s.col4}>
                <h3 className={s.h3sm}>
                  <Icon name="info" size={16} />
                  What improved
                </h3>
                <p className={s.body}>
                  A 0.5B model on grade-school math learned to finish its answers in the
                  expected format.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* The record */}
        <section className={`${s.section} ${s.ruleTop}`} id="record">
          <div className={s.container}>
            <div className={s.splitHead}>
              <div className={s.sectionHead}>
                <Eyebrow icon="record">The record</Eyebrow>
                <h2 className={s.h2}>Every decision is on the record</h2>
              </div>
              <p>
                Each message, review, checkpoint and score is saved with the campaign. Replay
                the run and trace any number back to its evidence.
              </p>
            </div>
            <div className={s.cards3}>
              <div className={s.card}>
                <div className={s.cardMedia}>
                  <img
                    src="/site/experiments.webp"
                    width={1142}
                    height={308}
                    alt="Experiment history with development results for exp-001 and exp-002"
                    loading="lazy"
                  />
                </div>
                <h3 className={s.h3sm}>
                  <Icon name="experiments" size={16} />
                  Experiments with their evidence
                </h3>
                <p className={s.body}>
                  Each experiment keeps its settings, development score, checkpoint hash and
                  verdict.
                </p>
              </div>
              <div className={s.card}>
                <div className={s.cardMedia}>
                  <img
                    src="/site/brief-production.webp"
                    width={1142}
                    height={99}
                    alt="Held-out production failures: original 0 of 33, candidate 9 of 33"
                    loading="lazy"
                  />
                </div>
                <h3 className={s.h3sm}>
                  <Icon name="production" size={16} />
                  Held-out checks you can read
                </h3>
                <p className={s.body}>
                  Each test question shows the original answer and the new one, side by side.
                </p>
              </div>
              <div className={s.card}>
                <div className={s.cardMedia}>
                  <img
                    src="/site/ledger.webp"
                    width={1142}
                    height={515}
                    alt="Governance decision ledger with four reviews"
                    loading="lazy"
                  />
                </div>
                <h3 className={s.h3sm}>
                  <Icon name="governance" size={16} />
                  A governance ledger
                </h3>
                <p className={s.body}>
                  Preflight and checkpoint reviews, each tied to a policy version and an
                  experiment.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Inverted band: the agents in their own words */}
        <section className={`${s.sectionTight} ${s.dark}`} data-header-theme="dark" id="voices">
          <div className={s.container}>
            <QuoteCarousel quotes={QUOTES} />
            <div className={s.tiles}>
              {ACTORS.map(([name, text]) => (
                <div className={s.tile} key={name}>
                  <strong>{name}</strong>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Lab views */}
        <section className={`${s.sectionTight} ${s.band}`} id="lab">
          <div className={s.container}>
            <div className={s.sectionHead}>
              <Eyebrow icon="overview">The lab</Eyebrow>
              <h2 className={s.h2}>Watch it work, live</h2>
            </div>
            <div className={s.labCards}>
              {[
                ["view-production-failures", "Production failures", "Every flagged answer, the detector that caught it and the audit against reviewer labels."],
                ["view-agent-chat", "Agent chat", "The research room and every direct message between the five agents."],
                ["view-results", "Results", "The sealed test, the held-out failures and a download for your checkpoint."],
              ].map(([img, title, text]) => (
                <a href="/" className={s.labCard} key={img}>
                  <img src={`/site/${img}.webp`} width={1440} height={900} alt={`Forge ${title} view`} loading="lazy" />
                  <h3>{title}</h3>
                  <p className={s.small}>{text}</p>
                  <span className={s.tag}>Lab view</span>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className={s.cta}>
          <CtaGrid className={s.ctaGrid} />
          <div className={s.container}>
            <div className={s.ctaText}>
              <h2 className={s.h1}>
                <span className={s.soft}>Your traffic.</span>
                <br />
                Your model.
              </h2>
              <div className={s.ctaRow}>
                <a href="/" className={s.btn}>
                  Open the lab
                </a>
                <a href="#results" className={s.btnGhost}>
                  See the results
                </a>
              </div>
              <p className={s.ctaNote}>One recorded campaign: about 12 minutes on one H100.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={s.container}>
          <div className={s.footerTop}>
            <span className={s.footerBrand}>
              <ForgeMark size={30} />
              forge.
            </span>
            <div className={s.footerCols}>
              <div>
                <h2>Product</h2>
                <ul>
                  <li><a href="#production">Production failures</a></li>
                  <li><a href="#agents">Agents</a></li>
                  <li><a href="#durable">Durable actors</a></li>
                  <li><a href="#training">Training</a></li>
                </ul>
              </div>
              <div>
                <h2>Evidence</h2>
                <ul>
                  <li><a href="#platform">How it works</a></li>
                  <li><a href="#results">Results</a></li>
                  <li><a href="#record">The record</a></li>
                </ul>
              </div>
              <div>
                <h2>Lab</h2>
                <ul>
                  <li><a href="/">Open the lab</a></li>
                  <li><a href="#lab">Lab views</a></li>
                </ul>
              </div>
            </div>
          </div>
          <div className={s.footerBottom}>
            <span>Forge · Fully automated post-training</span>
            <span>© 2026 Forge</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
