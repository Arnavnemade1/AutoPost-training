/* eslint-disable @next/next/no-img-element -- one static product capture with fixed size */
import Link from "next/link";
import { ForgeMark, Icon } from "@/components/icon";
import { SiteHeader } from "@/components/site/header";
import {
  BuiltWith,
  CtaGrid,
  HeroGrid,
  ProductNav,
  QuoteCarousel,
  type Logo,
  type Quote,
} from "@/components/site/motion";
import {
  AgentFlow,
  AuditCard,
  HeroCampaign,
  RecoveryTimeline,
  TypedCode,
  TypedExample,
} from "@/components/site/live";
import {
  JournalDrawing,
  TeamDrawing,
  TracesDrawing,
} from "@/components/site/drawings";
import { EXPERIMENTS, MESSAGES, REVIEWS, ROLES } from "@/components/site/data";
import s from "@/components/site/site.module.css";

// Every number on this page comes from campaign forge-e84925eb. Sources are listed in
// components/site/data.ts and docs/site/modal-reference.md.

const SIDE = [
  { id: "production", label: "Mistakes", icon: "production" },
  { id: "agents", label: "Agents", icon: "chat" },
  { id: "durable", label: "Memory", icon: "terse" },
  { id: "training", label: "Proof", icon: "results" },
];

// Official marks only; every one is a dependency in pyproject.toml or package.json.
const BUILT_WITH: Logo[] = [
  {
    src: "/site/logos/pytorch.svg",
    name: "PyTorch",
    width: 487,
    height: 120,
    h: 26,
  },
  {
    src: "/site/logos/huggingface.svg",
    name: "Hugging Face",
    width: 963,
    height: 256,
    h: 34,
  },
  { src: "/site/logos/qwen.svg", name: "Qwen", width: 24, height: 24, h: 28 },
  {
    src: "/site/logos/eleutherai.svg",
    name: "EleutherAI",
    width: 800,
    height: 149,
    h: 22,
  },
  {
    src: "/site/logos/agent-relay.svg",
    name: "Agent Relay",
    width: 340,
    height: 54,
    h: 24,
  },
  {
    src: "/site/logos/terse-durable-actors.png",
    name: "Durable Actors by Terse",
    width: 1370,
    height: 290,
    h: 32,
  },
];

const QUOTES: Quote[] = MESSAGES.map((m) => ({
  initials: ROLES[m.from].initials,
  from: ROLES[m.from].name,
  to: m.to === "room" ? "the research room" : ROLES[m.to].name,
  category: m.category,
  time: m.time,
  text: m.text,
}));

const ACTORS = [
  ["ResearchCampaign", "The goal, the budget and the best checkpoint"],
  ["Experiment", "Settings, worker leases and results"],
  ["Governance", "A signed approval for each checkpoint"],
  ["ArtifactRegistry", "Every saved file and its checksum"],
  ["RLWorld", "Math worlds that score each answer"],
  ["ResearchLedger", "Every diagnosis, idea and decision"],
];

const LAUNCH = `await fetch("/api/lab/campaigns", {
  method: "POST",
  body: JSON.stringify({
    production_scan: "scan-b1b36ecf",
    strategies: ["targeted_sft", "broad_sft"],
    max_experiments: 2,
    train_steps: 96,
    dev_samples: 24,
    final_samples: 24,
  }),
});`;

const ARTIFACTS = [
  ["Dataset provenance", "00:25:13"],
  ["Baseline evaluation", "00:28:32"],
  ["exp-001 LoRA weights", "00:29:22"],
  ["exp-001 checkpoint bundle", "00:29:22"],
  ["Sealed final evaluation", "00:36:46"],
  ["Research report", "00:36:46"],
];

function Eyebrow({
  icon,
  children,
}: {
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <span className={s.eyebrow}>
      <span className={s.eyebrowIcon}>
        <Icon name={icon} size={12} />
      </span>
      {children}
    </span>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
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

function Scale({
  before,
  after,
  n,
}: {
  before: number;
  after: number;
  n: number;
}) {
  const x = (v: number) => `${(v / n / 0.5) * 100}%`;
  return (
    <div className={s.scale} aria-hidden="true">
      <div className={s.scaleTrack} />
      <div
        className={s.scaleSpan}
        style={{ left: x(before), width: `calc(${x(after)} - ${x(before)})` }}
      />
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
                Forge reads your agent&apos;s real conversations, trains a
                private model on the answers it missed, and shows you exactly
                what improved. You keep the model.
              </p>
              <div className={s.ctaRow}>
                <Link href="/" className={s.btn}>
                  Open the lab
                </Link>
                <a href="#results" className={s.btnGhost}>
                  See the results
                </a>
              </div>
            </div>
            <div className={s.heroShot}>
              <HeroCampaign />
              <p className={s.caption}>
                A replay of campaign forge-e84925eb, using the run&apos;s own
                data.
              </p>
            </div>
            <div className={s.strip}>
              <p className={s.stripLabel}>Built with</p>
              <span className={s.stripDivider} aria-hidden="true" />
              <div className={s.stripLoop}>
                <BuiltWith logos={BUILT_WITH} />
              </div>
            </div>
          </div>
        </section>

        {/* One question, before and after */}
        <section className={s.section} id="example">
          <div className={s.container}>
            <div className={s.sectionHead}>
              <Eyebrow icon="target">Example</Eyebrow>
              <h2 className={s.h2}>One question, before and after</h2>
            </div>
            <TypedExample />
          </div>
        </section>

        {/* Product */}
        <section className={`${s.section} ${s.ruleTop}`} id="product">
          <div className={s.container}>
            <div className={s.sectionHead}>
              <Eyebrow icon="overview">How Forge works</Eyebrow>
              <h2 className={s.h2}>From real mistakes to a model you own</h2>
            </div>
            <div className={`${s.grid} ${s.product}`}>
              <ProductNav items={SIDE} />
              <div className={s.blocks}>
                <article className={s.block} id="production">
                  <div className={s.blockText}>
                    <h3 className={s.h3}>It finds the mistakes</h3>
                    <p className={`${s.lead} ${s.blockLead}`}>
                      Upload your agent&apos;s conversations. Forge flags the
                      answers that went wrong, with no answer key.
                    </p>
                    <div className={s.features}>
                      <Feature icon="search" title="Four checks">
                        A missing final answer, a reply that was cut off, a
                        miscalculation, or a correction from the user.
                      </Feature>
                      <Feature icon="target" title="Checked by people">
                        Reviewers confirmed all 62 flagged answers. Forge caught
                        62 of the 63.
                      </Feature>
                      <Feature icon="lock" title="Test questions set aside">
                        Anything that matches the final test is removed first.
                      </Feature>
                    </div>
                  </div>
                  <div className={s.visual}>
                    <AuditCard />
                  </div>
                </article>

                <article className={s.block} id="agents">
                  <div className={s.blockText}>
                    <h3 className={s.h3}>Five agents do the work</h3>
                    <p className={`${s.lead} ${s.blockLead}`}>
                      A data researcher, a director, a trainer, an evaluator and
                      a governance council. They talk over Agent Relay, and
                      every message is kept.
                    </p>
                    <div className={s.features}>
                      <Feature icon="message" title="Direct messages">
                        Each handoff goes to one agent, who confirms it before
                        starting.
                      </Feature>
                      <Feature icon="chat" title="A shared room">
                        Plans, checkpoints and results are posted for the whole
                        team.
                      </Feature>
                      <Feature icon="governance" title="Replies in threads">
                        The council answers under each checkpoint.
                      </Feature>
                      <Feature icon="check" title="Read receipts">
                        You can see who read each message, and when.
                      </Feature>
                    </div>
                  </div>
                  <div className={s.visual}>
                    <AgentFlow />
                  </div>
                </article>

                <article className={s.block} id="durable">
                  <div className={s.blockText}>
                    <h3 className={s.h3}>
                      A record you can always resume from
                    </h3>
                    <p className={`${s.lead} ${s.blockLead}`}>
                      Budgets, reviews and checkpoints live in Terse durable
                      actors, so a run picks up exactly where it was.
                    </p>
                    <div className={s.features}>
                      <Feature icon="alert" title="Stopped on purpose">
                        In the recorded run we force-stopped the runtime during
                        training.
                      </Feature>
                      <Feature icon="refresh" title="Back in 28.3 seconds">
                        All 4 actors came back exactly as they were.
                      </Feature>
                      <Feature icon="clock" title="Every second counted once">
                        Training continued 0.6 seconds later. 198.7 seconds of
                        compute, counted once.
                      </Feature>
                    </div>
                  </div>
                  <div className={s.visual}>
                    <RecoveryTimeline />
                  </div>
                </article>

                <article className={s.block} id="training">
                  <div className={s.blockText}>
                    <h3 className={s.h3}>It proves the result</h3>
                    <p className={`${s.lead} ${s.blockLead}`}>
                      Forge tests the new model on questions it never trained
                      on. Then you download it.
                    </p>
                    <div className={s.features}>
                      <Feature
                        icon="production"
                        title="Saved-for-later failures"
                      >
                        Half of the real failures are kept for testing. 0 of 33
                        became 9 of 33.
                      </Feature>
                      <Feature icon="lock" title="A final test, opened once">
                        1 of 24 became 6 of 24.
                      </Feature>
                      <Feature icon="governance" title="A council approves">
                        The council promotes the checkpoint with the best
                        practice score.
                      </Feature>
                      <Feature icon="download" title="Yours to keep">
                        Download the model, the report and every step of the
                        research.
                      </Feature>
                    </div>
                    <a href="#results" className={`${s.btn} ${s.blockButton}`}>
                      See the results
                    </a>
                  </div>
                  <div className={s.visual}>
                    <TypedCode
                      title="Start a campaign from your failures"
                      code={LAUNCH}
                    />
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
              <Eyebrow icon="environments">Under the hood</Eyebrow>
              <h2 className={s.h2}>Every step leaves evidence you can check</h2>
            </div>
            <div className={s.cols3}>
              <div className={s.col}>
                <span className={s.colNum}>1</span>
                <div className={s.drawing}>
                  <TracesDrawing />
                </div>
                <h3 className={s.h3}>It learns from your traffic</h3>
                <p className={s.body}>
                  Your agent&apos;s own answers become the lesson plan.
                </p>
              </div>
              <div className={s.col}>
                <span className={s.colNum}>2</span>
                <div className={s.drawing}>
                  <TeamDrawing />
                </div>
                <h3 className={s.h3}>The team checks its own work</h3>
                <p className={s.body}>
                  The trainer hands each checkpoint to the evaluator, and the
                  council reviews it against a fixed policy.
                </p>
              </div>
              <div className={s.col}>
                <span className={s.colNum}>3</span>
                <div className={s.drawing}>
                  <JournalDrawing />
                </div>
                <h3 className={s.h3}>Every step is signed and saved</h3>
                <p className={s.body}>
                  Each change carries a signature and goes into a journal, so
                  the whole run can be replayed.
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
            </div>
            <div className={s.resultsPanel}>
              <div className={s.resultRow}>
                <div className={s.resultLabel}>
                  <h3>Saved-for-later production failures</h3>
                  <p className={s.small}>
                    Real failures from the traffic, kept out of training.
                  </p>
                </div>
                <Scale before={0} after={9} n={33} />
                <div className={s.gain}>
                  <div className={s.gainNum}>
                    +27.3<small>pp</small>
                  </div>
                  <p className={s.small}>95% interval +12.1 to +42.4</p>
                </div>
              </div>
              <div className={s.resultRow}>
                <div className={s.resultLabel}>
                  <h3>Final test</h3>
                  <p className={s.small}>
                    24 grade-school math questions, opened once at the end.
                  </p>
                </div>
                <Scale before={1} after={6} n={24} />
                <div className={s.gain}>
                  <div className={s.gainNum}>
                    +20.8<small>pp</small>
                  </div>
                  <p className={s.small}>95% interval +4.2 to +37.5</p>
                </div>
              </div>
            </div>
            <p className={s.resultsMeta}>
              Campaign forge-e84925eb · Qwen2.5-0.5B-Instruct · about 12 minutes
              · paired bootstrap 95% intervals
            </p>
            <div className={s.cols4}>
              <div className={s.col4}>
                <h3 className={s.h3sm}>
                  <Icon name="check" size={16} />
                  Every right answer kept
                </h3>
                <p className={s.body}>
                  Every question the original model answered correctly, the new
                  one still does.
                </p>
              </div>
              <div className={s.col4}>
                <h3 className={s.h3sm}>
                  <Icon name="experiments" size={16} />
                  Picked on practice questions
                </h3>
                <p className={s.body}>
                  The best checkpoint is chosen from practice scores, so the
                  test stays fair.
                </p>
              </div>
              <div className={s.col4}>
                <h3 className={s.h3sm}>
                  <Icon name="lock" size={16} />
                  One attempt
                </h3>
                <p className={s.body}>
                  Each model answers the final test exactly once.
                </p>
              </div>
              <div className={s.col4}>
                <h3 className={s.h3sm}>
                  <Icon name="info" size={16} />
                  What improved
                </h3>
                <p className={s.body}>
                  A small model learned to finish its answers in the expected
                  format.
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
                Each message, review, checkpoint and score is saved with the
                campaign. Trace any number back to where it came from.
              </p>
            </div>
            <div className={s.cards3}>
              <div className={s.card}>
                <div className={s.recordCard}>
                  <div className={s.recordHead}>Experiments</div>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>Practice</th>
                        <th>Held out</th>
                        <th>Verdict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {EXPERIMENTS.map((e) => (
                        <tr key={e.id}>
                          <td className={s.mono}>{e.id}</td>
                          <td className={s.num}>{e.dev}</td>
                          <td className={s.num}>{e.heldOut}</td>
                          <td>{e.verdict}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className={s.recordNote}>
                    Learning rate {EXPERIMENTS[0].lr} and {EXPERIMENTS[1].lr},
                    96 steps each.
                  </p>
                </div>
                <h3 className={s.h3sm}>
                  <Icon name="experiments" size={16} />
                  Experiments with their evidence
                </h3>
                <p className={s.body}>
                  Each run keeps its settings, scores, checkpoint hash and
                  verdict.
                </p>
              </div>
              <div className={s.card}>
                <div className={s.recordCard}>
                  <div className={s.recordHead}>Governance reviews</div>
                  <ul className={s.ledger}>
                    {REVIEWS.map((r) => (
                      <li key={`${r.title}-${r.target}`}>
                        <span className={s.tick}>
                          <Icon name="check" size={14} />
                        </span>
                        <span>
                          {r.title}
                          <span className={s.mono}>
                            {r.target} · forge-policy-v1 · {r.time}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <h3 className={s.h3sm}>
                  <Icon name="governance" size={16} />A governance ledger
                </h3>
                <p className={s.body}>
                  Every review is tied to a policy version and an experiment.
                </p>
              </div>
              <div className={s.card}>
                <div className={s.recordCard}>
                  <div className={s.recordHead}>Saved files</div>
                  <ul className={s.ledger}>
                    {ARTIFACTS.map(([name, time]) => (
                      <li key={name}>
                        <span className={s.tick}>
                          <Icon name="artifacts" size={14} />
                        </span>
                        <span>
                          {name}
                          <span className={s.mono}>{time} UTC</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <h3 className={s.h3sm}>
                  <Icon name="download" size={16} />
                  Everything is downloadable
                </h3>
                <p className={s.body}>
                  The weights, the report and the full research trace.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Inverted band: the agents in their own words */}
        <section
          className={`${s.sectionTight} ${s.dark}`}
          data-header-theme="dark"
          id="voices"
        >
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

        {/* The product, once */}
        <section className={`${s.sectionTight} ${s.band}`} id="lab">
          <div className={s.container}>
            <div className={s.splitHead}>
              <div className={s.sectionHead}>
                <Eyebrow icon="overview">The lab</Eyebrow>
                <h2 className={s.h2}>Watch every run as it happens</h2>
              </div>
              <p>
                The research room, every experiment and the results live in one
                place while the run is going.
              </p>
            </div>
            <figure className={s.productShot}>
              <div className={s.frame}>
                <img
                  src="/site/hero-chat.webp"
                  width={2000}
                  height={1250}
                  alt="Forge lab: the research room with messages between the five agents"
                  loading="lazy"
                />
              </div>
            </figure>
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
                <Link href="/" className={s.btn}>
                  Open the lab
                </Link>
                <a href="#results" className={s.btnGhost}>
                  See the results
                </a>
              </div>
              <p className={s.ctaNote}>
                The recorded run took about 12 minutes from click to model.
              </p>
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
                  <li>
                    <a href="#production">Finding mistakes</a>
                  </li>
                  <li>
                    <a href="#agents">Agents</a>
                  </li>
                  <li>
                    <a href="#durable">Memory</a>
                  </li>
                  <li>
                    <a href="#training">Proof</a>
                  </li>
                </ul>
              </div>
              <div>
                <h2>Evidence</h2>
                <ul>
                  <li>
                    <a href="#example">Example</a>
                  </li>
                  <li>
                    <a href="#results">Results</a>
                  </li>
                  <li>
                    <a href="#record">The record</a>
                  </li>
                </ul>
              </div>
              <div>
                <h2>Lab</h2>
                <ul>
                  <li>
                    <Link href="/">Open the lab</Link>
                  </li>
                  <li>
                    <a href="#lab">Inside the lab</a>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <div className={s.footerBottom}>
            <span>Forge · Your own model, trained on your own traffic</span>
            <span>© 2026 Forge</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
