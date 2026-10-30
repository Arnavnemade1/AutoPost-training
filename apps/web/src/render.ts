import type { CampaignView, ExperimentView, HarnessPair, Score } from "./campaign.js";
import { budgetMeter, esc, ledgerGraph, rewardChart, seriesSlot } from "./charts.js";

/**
 * Server-rendered dashboard. Every number comes from `CampaignView`, which reads stored
 * files; values link to the file they came from. `live` is a compact single-screen
 * layout for recording; `full` is the browsing dashboard.
 */
export type View = "full" | "live";

const money = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(2)}`;
const score = (s: Score | null, testId: string) =>
  s
    ? `<span data-testid="${esc(testId)}" data-correct="${s.correct}" data-total="${s.total}">${s.correct}/${s.total}</span>`
    : `<span data-testid="${esc(testId)}">—</span>`;
const fileLink = (path: string, text: string) =>
  `<a href="/files/${path.split("/").map(encodeURIComponent).join("/")}">${esc(text)}</a>`;
const sourceNote = (s: Score | null) =>
  s
    ? `<span class="source">from ${fileLink(s.source.path, s.source.path)} · <code>${s.source.sha256.slice(0, 12)}</code></span>`
    : "";

function status(
  text: string,
  tone: "good" | "critical" | "warning" | "neutral" | "active",
): string {
  const icon = { good: "✓", critical: "✕", warning: "!", neutral: "•", active: "●" }[tone];
  return `<span class="status ${tone}"><span class="icon" aria-hidden="true">${icon}</span>${esc(text)}</span>`;
}
function experimentTone(e: ExperimentView): Parameters<typeof status>[1] {
  if (e.status === "failed") return "critical";
  if (e.status === "evaluated" || e.status === "completed") return "good";
  if (e.status === "running") return "active";
  return "neutral";
}

function header(c: CampaignView): string {
  const recording = c.recording;
  const recordingPill =
    recording.status === "recording"
      ? status(`Recording · ${recording.frames ?? 0} frames`, "active")
      : recording.status === "failed"
        ? status("Recording failed", "critical")
        : recording.status === "finished"
          ? status("Recording finished", "good")
          : recording.status === "preflight"
            ? status("Recording preflight", "warning")
            : status("Not recording", "neutral");
  const campaignTone =
    c.status === "failed"
      ? "critical"
      : c.status === "finished"
        ? "good"
        : c.status === "running" || c.status === "finalizing"
          ? "active"
          : "neutral";
  return `<header class="top">
  <div class="title"><h1>Forge research command center</h1>
    <p class="subtitle">${esc(c.campaignId ?? "No campaign yet")}${c.profile ? ` · profile ${esc(c.profile)}` : ""}${c.method ? ` · ${esc(c.method)}` : ""}${c.model ? ` · ${c.model.modelId.startsWith("/") ? `local model <code>${esc(c.model.revision.slice(0, 12))}</code>` : esc(c.model.modelId)}` : ""}</p></div>
  <div class="pills"><span data-testid="campaign-status">${status(`Campaign ${c.status}`, campaignTone)}</span><span data-testid="recording-status" data-status="${recording.status}">${recordingPill}</span></div>
</header>`;
}

function alerts(c: CampaignView): string {
  const parts: string[] = [];
  if (c.recording.status === "failed")
    parts.push(
      `<div class="alert critical" role="alert" data-testid="recording-failure"><strong>Recording failed before the campaign could start.</strong> ${esc(c.recording.error ?? "No error was recorded.")} ${c.status === "waiting" ? "The campaign was not started." : "The campaign ran unrecorded (<code>--allow-unrecorded</code>)."}</div>`,
    );
  if (c.fixture)
    parts.push(
      `<div class="alert warning" data-testid="fixture-banner"><strong>Fixture model.</strong> An offline tiny model exercises the mechanics; its scores are not evidence about a useful model.</div>`,
    );
  for (const warning of c.warnings) parts.push(`<div class="alert warning">${esc(warning)}</div>`);
  return parts.join("");
}

function kpis(c: CampaignView): string {
  const best = [...c.experiments]
    .filter((e) => e.development)
    .sort(
      (a, b) => b.development!.correct - a.development!.correct || a.label.localeCompare(b.label),
    )[0];
  const rollouts = c.experiments.reduce(
    (n, e) => n + e.updates.reduce((m, p) => m + p.rollouts, 0),
    0,
  );
  const rewarded = c.experiments.reduce(
    (n, e) => n + e.updates.reduce((m, p) => m + p.rewardSum, 0),
    0,
  );
  const budget = c.budget;
  return `<section class="kpis" aria-label="Headline numbers">
  <div class="tile"><h2>${c.startingAdapter ? "Starting policy" : "Baseline"}</h2><p class="value">${score(c.baseline, "baseline-score")}</p><p class="note">development${c.startingAdapter ? ` · adapter <code>${esc(c.startingAdapter.slice(0, 12))}</code>` : " · untrained model"}</p>${sourceNote(c.baseline)}</div>
  <div class="tile"><h2>Best development candidate</h2><p class="value">${best ? score(best.development, "best-score") : score(null, "best-score")}</p><p class="note">${best ? esc(best.label) : "none evaluated yet"}</p>${best ? sourceNote(best.development) : ""}</div>
  <div class="tile"><h2>Promoted</h2><p class="value" data-testid="promoted">${c.promoted ? esc(c.promoted) : "None"}</p><p class="note">${c.stop ? `stopped: ${esc(c.stop.rule)}` : "campaign open"}</p></div>
${finalTile(c)}
  <div class="tile"><h2>Rollouts rewarded by worlds</h2><p class="value" data-testid="rollouts-total" data-rewarded="${rewarded}" data-rollouts="${rollouts}">${rewarded}/${rollouts}</p><p class="note">every reward is an RLWorldActor transition</p></div>
  <div class="tile"><h2>Budget used</h2>${
    budget && Number.isFinite(budget.maxMicroUsd)
      ? `<p class="value"><span data-testid="budget-used" data-micro-usd="${budget.spentMicroUsd + budget.reservedMicroUsd}">${money(budget.spentMicroUsd + budget.reservedMicroUsd)}</span> <span class="of">of <span data-testid="budget-max" data-micro-usd="${budget.maxMicroUsd}">${money(budget.maxMicroUsd)}</span></span></p>${budgetMeter(budget.maxMicroUsd, budget.spentMicroUsd, budget.reservedMicroUsd)}<p class="note">${budget.measured ? "measured cost" : "local cost unmeasured; charged at each reservation's bound"}</p>`
      : budget
        ? `<p class="value"><span data-testid="budget-used" data-micro-usd="${budget.spentMicroUsd + budget.reservedMicroUsd}">${money(budget.spentMicroUsd + budget.reservedMicroUsd)}</span></p><p class="note">cap not in the stored files; local cost unmeasured</p>`
        : `<p class="value">—</p><p class="note">no budget recorded</p>`
  }</div>
</section>`;
}

function experimentsTable(c: CampaignView, compact: boolean): string {
  if (!c.experiments.length) return `<p class="empty">No experiments yet.</p>`;
  const rows = c.experiments
    .map((e) => {
      const rewarded = `${e.updates.reduce((n, p) => n + p.rewardSum, 0)}/${e.updates.reduce((n, p) => n + p.rollouts, 0)}`;
      const progress = e.updates.length
        ? compact
          ? `${e.updates.length}${e.maxUpdates ? `/${e.maxUpdates}` : ""} · ${rewarded} rewarded`
          : `${e.updates.length}${e.maxUpdates ? `/${e.maxUpdates}` : ""} updates · ${rewarded} rewarded`
        : "—";
      const governance = e.governance
        ? status(
            e.governance.decision === "approved"
              ? "Approved"
              : `Vetoed: ${e.governance.reasonCodes.join(", ")}`,
            e.governance.decision === "approved" ? "good" : "critical",
          )
        : "—";
      const recipe = e.recipe
        ? `${esc(e.recipe.data ?? "")} · lr ${esc(e.recipe.learningRate ?? "")} · ${esc(e.recipe.maxSteps ?? "")} steps`
        : "—";
      return `<tr>
        <th scope="row"><span class="swatch s${seriesSlot(c.experiments, e.label)}" aria-hidden="true"></span>${esc(e.label)}</th>
        ${compact ? "" : `<td>${esc(e.operator ?? "—")}</td><td>${recipe}</td>`}
        <td>${status(e.status, experimentTone(e))}</td>
        <td>${progress}</td>
        <td class="num">${score(e.development, `dev-score-${e.label}`)}</td>
        ${compact ? "" : `<td class="num">${e.governance?.regression ? `${e.governance.regression.candidateCorrect}/${e.governance.regression.total}` : "—"}</td>`}
        <td>${governance}</td>
      </tr>`;
    })
    .join("");
  return `<div tabindex="0" role="region" aria-label="Experiments table" class="scroll"><table class="experiments"><caption>Experiments, in label order</caption>
  <thead><tr><th scope="col">Experiment</th>${compact ? "" : `<th scope="col">Operator</th><th scope="col">Recipe</th>`}<th scope="col">Status</th><th scope="col">Training</th><th scope="col" class="num">Development</th>${compact ? "" : `<th scope="col" class="num">Held-out</th>`}<th scope="col">Governance</th></tr></thead>
  <tbody>${rows}</tbody></table></div>`;
}

function ledgerList(c: CampaignView): string {
  return `<details><summary>Every ledger entry</summary><ol class="ledger">${c.ledger
    .map(
      (e) =>
        `<li><strong>${esc(e.kind)} ${e.sequence}</strong> <code>${esc(e.entryId)}</code>${e.parents.length ? ` ← ${e.parents.map(esc).join(", ")}` : ""}<br>${esc(e.summary)}</li>`,
    )
    .join("")}</ol></details>`;
}

function inspector(c: CampaignView, label: string | null, limit: number): string {
  const withRollouts = c.experiments.filter((e) => e.latestRollouts.length);
  const chosen = withRollouts.find((e) => e.label === label) ?? withRollouts.at(-1);
  if (!chosen) return `<p class="empty">No world transitions recorded yet.</p>`;
  const choices = withRollouts
    .map((e) =>
      e === chosen
        ? `<strong aria-current="true">${esc(e.label)}</strong>`
        : `<a href="?inspect=${encodeURIComponent(e.label)}#environment">${esc(e.label)}</a>`,
    )
    .join(" · ");
  const rows = chosen.latestRollouts
    .slice(0, limit)
    .map(
      (r) => `<tr><th scope="row">${r.index}</th><td><code>${esc(r.taskId)}</code></td>
      <td class="completion">${esc(r.completion.length > 160 ? `…${r.completion.slice(-160)}` : r.completion)}</td>
      <td><code>${esc(r.answer)}</code></td><td>${r.reward === 1 ? status("1", "good") : status("0", "neutral")}</td>
      <td><code title="${esc(r.worldId)}">${esc(r.episodeId)}</code></td></tr>`,
    )
    .join("");
  return `<p class="note">Latest update ${chosen.latestRollouts[0].update} of ${esc(chosen.label)}${withRollouts.length > 1 ? ` · ${choices}` : ""}. Rewards are the world actors' transitions${chosen.rolloutsSource ? `, recorded in ${fileLink(chosen.rolloutsSource.path, "rollouts.jsonl")}` : ""}.</p>
  <div tabindex="0" role="region" aria-label="World transitions table" class="scroll"><table><caption>World transitions for one update</caption><thead><tr><th scope="col">#</th><th scope="col">Task</th><th scope="col">Completion (end)</th><th scope="col">Submitted</th><th scope="col">Reward</th><th scope="col">Episode</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function governancePanel(c: CampaignView): string {
  const reviewed = c.experiments.filter((e) => e.governance);
  if (!reviewed.length) return `<p class="empty">No governance review yet.</p>`;
  return reviewed
    .map((e) => {
      const g = e.governance!;
      const checks = Object.entries(g.checks)
        .map(
          ([name, ok]) =>
            `<li>${status(name.replace(/([A-Z])/g, " $1").toLowerCase(), ok ? "good" : "critical")}</li>`,
        )
        .join("");
      return `<article class="review"><h3>${esc(e.label)}: ${g.decision === "approved" ? status("approved", "good") : status(`vetoed (${g.reasonCodes.join(", ")})`, "critical")}</h3>
      <ul class="checks">${checks}</ul>
      <p class="note">${g.regression ? `Held-out suite ${g.regression.baselineCorrect}/${g.regression.total} before, ${g.regression.candidateCorrect}/${g.regression.total} after. ` : ""}${g.developmentRegressions !== null ? `${g.developmentRegressions} development example${g.developmentRegressions === 1 ? "" : "s"} lost. ` : ""}${g.worldRewards ? `World journals: ${g.worldRewards.transitionsInJournals} transitions for ${g.worldRewards.rollouts} rollouts. ` : ""}Evidence ${fileLink(g.source.path, g.source.path)} <code>${g.source.sha256.slice(0, 12)}</code>.</p></article>`;
    })
    .join("");
}

function examplesPanel(c: CampaignView): string {
  if (!c.examples) return `<p class="empty">No evaluated candidate yet.</p>`;
  const verdict = (x: { correct: boolean; diagnosis: string }) =>
    x.correct ? status("correct", "good") : status(x.diagnosis.replaceAll("_", " "), "critical");
  const rows = c.examples.rows
    .map(
      (r) => `<tr><th scope="row"><code>${esc(r.id)}</code></th><td>${esc(r.reference)}</td>
      <td>${verdict(r.before)}<div class="prediction">${esc(r.before.prediction.slice(-140))}</div></td>
      <td>${verdict(r.after)}<div class="prediction">${esc(r.after.prediction.slice(-140))}</div></td></tr>`,
    )
    .join("");
  return `<p class="note">Development examples: the ${c.startingAdapter ? "starting policy" : "baseline"} against ${esc(c.examples.label)}, the development-selected candidate. Predictions show their last 140 characters.</p>
  <div tabindex="0" role="region" aria-label="Before and after table" class="scroll"><table><caption>Before and after, per development example</caption><thead><tr><th scope="col">Example</th><th scope="col">Reference</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function messagesPanel(c: CampaignView, limit: number): string {
  if (!c.messages.length) return `<p class="empty">No agent messages exported yet.</p>`;
  const shown = c.messages.slice(-limit);
  const rows = shown
    .map(
      (m) =>
        `<tr><th scope="row">${m.sequence}</th><td><code>${esc(m.kind)}</code></td><td>${esc(m.from)} → ${esc(m.to)}</td><td>${esc(m.experiment)}</td><td>${m.acknowledged ? status("acknowledged", "good") : m.sent ? status("sent", "active") : status("queued", "neutral")}</td></tr>`,
    )
    .join("");
  return `<div tabindex="0" role="region" aria-label="Agent messages table" class="scroll"><table><caption>${shown.length < c.messages.length ? `Latest ${shown.length} of ${c.messages.length}` : `All ${c.messages.length}`} Relay messages from the durable workflow outbox</caption><thead><tr><th scope="col">Seq</th><th scope="col">Kind</th><th scope="col">Route</th><th scope="col">Experiment</th><th scope="col">Delivery</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

const checkTone = (value: string): Parameters<typeof status>[1] =>
  value === "passed" || value === "recorded"
    ? "good"
    : value === "failed"
      ? "critical"
      : value === "unverified" || value === "pending"
        ? "warning"
        : "neutral";
const words = (name: string) => name.replace(/([A-Z])/g, " $1").toLowerCase();

/** Headline tile: the sealed result once it exists, else the release rehearsal. */
function finalTile(c: CampaignView): string {
  const f = c.final;
  const pair = f.sealed ?? f.rehearsal;
  if (!pair) return "";
  const kind = f.sealed ? "sealed" : "rehearsal";
  return `<div class="tile"><h2>${f.sealed ? "Sealed GSM8K test" : "Release rehearsal"}</h2><p class="value">${score(pair.strict.baseline, `${kind}-baseline-kpi`)} <span class="of">→</span> ${score(pair.strict.candidate, `${kind}-candidate-kpi`)}</p><p class="note">${f.sealed ? "strict match · run once" : "strict match · development data, not a final claim"}</p></div>`;
}

function finalPanel(c: CampaignView): string {
  const f = c.final;
  if (f.status === "absent")
    return `<p class="empty" data-testid="final-status" data-status="absent">No final evaluation. After the campaign stops, <code>--finalize</code> freezes the promoted checkpoint and packages a release; the sealed test runs once, in the separately owned evaluator.</p>`;
  const head = f.frozen
    ? `<p data-testid="final-status" data-status="${f.status}">${status(`Frozen ${f.frozen.label}`, "good")} checkpoint <code data-testid="frozen-checkpoint">${esc(f.frozen.checkpointSha256.slice(0, 16))}</code> after the campaign stopped · development ${f.frozen.developmentCorrect}/${f.frozen.developmentExamples} · ${esc(f.frozen.frozenAt)}</p>`
    : `<p data-testid="final-status" data-status="${f.status}">${status("Not frozen", "critical")}</p>`;
  const failure =
    f.status === "failed"
      ? `<p>${status("Finalization stopped", "critical")} ${esc(f.reason ?? "")}</p>`
      : "";
  const release = f.release
    ? `<p class="note">Release <code data-testid="release-bundle">${esc(f.release.sha256.slice(0, 16))}</code> bound in the actor · EleutherAI lm-evaluation-harness <span data-testid="final-harness">${esc(f.release.harnessVersion ?? "—")}</span>, GSM8K task unmodified${f.release.protocol ? ` · ${f.release.protocol.fewshot}-shot, ${f.release.protocol.chat ? "chat template" : "plain prompt"}, ${f.release.protocol.maxNewTokens} new tokens, identical for both policies` : ""}.</p>`
    : "";
  const cell = (pair: { baseline: Score; candidate: Score }, id: string) =>
    `${score(pair.baseline, `${id}-baseline`)} → ${score(pair.candidate, `${id}-candidate`)}`;
  const row = (name: string, id: string, pair: HarnessPair | null, note: string) =>
    `<tr><th scope="row">${esc(name)}<div class="note">${note}</div></th>${
      pair
        ? `<td class="num">${cell(pair.strict, `${id}-strict`)}</td><td class="num">${cell(pair.flexible, `${id}-flexible`)}</td>`
        : `<td class="num">—</td><td class="num">—</td>`
    }</tr>`;
  const sealedNote = f.sealed
    ? f.recordMismatch
      ? status("actor record differs", "critical")
      : `${status("recorded by the final evaluator", "good")}${f.improvementSupported === null ? "" : ` · improvement gate ${f.improvementSupported ? "met" : "not met"}`}`
    : esc(f.sealedStatus?.reason ?? "not run");
  const table = `<div tabindex="0" role="region" aria-label="Harness results table" class="scroll"><table><caption>Starting policy → frozen checkpoint, correct answers</caption>
    <thead><tr><th scope="col">Evaluation</th><th scope="col" class="num">Strict match</th><th scope="col" class="num">Flexible extract</th></tr></thead><tbody>
    ${row("Development harness", "development", f.development, "selection data, paired")}
    ${row("Release rehearsal", "rehearsal", f.rehearsal, "the release path on development data; not a final claim")}
    ${row("Sealed GSM8K test", "sealed", f.sealed, sealedNote)}
    </tbody></table></div>`;
  const sources = [f.development, f.rehearsal, f.sealed]
    .filter((p): p is HarnessPair => !!p)
    .map((p) => sourceNote(p.strict.candidate))
    .join("");
  const checks = f.checks.length
    ? `<ul class="checks" data-testid="final-checks">${f.checks
        .map(
          (k) =>
            `<li data-check="${esc(k.name)}" data-status="${esc(k.status)}">${status(`${words(k.name)}: ${k.status}`, checkTone(k.status))}</li>`,
        )
        .join(
          "",
        )}</ul><p class="note">Gate checks from ${fileLink(f.checksSource!.path, f.checksSource!.path)} <code>${f.checksSource!.sha256.slice(0, 12)}</code>.</p>`
    : `<p class="note">No evidence bundle yet; gate checks are written with it.</p>`;
  return `${head}${failure}${release}${f.development || f.rehearsal || f.sealed ? table + sources : ""}${checks}`;
}

function recordingPanel(c: CampaignView): string {
  const r = c.recording;
  const exports = r.exports
    .map(
      (
        v,
      ) => `<figure class="video"><video controls preload="metadata" src="/files/${v.path.split("/").map(encodeURIComponent).join("/")}"></video>
      <figcaption>${esc(v.name)}: ${v.speed}× · ${v.frames} frames · ${v.durationSeconds.toFixed(1)} s</figcaption></figure>`,
    )
    .join("");
  return `<p class="note">Status <strong data-testid="recording-state">${esc(r.status)}</strong>${r.frames !== null ? ` · ${r.frames} source frames` : ""}${r.startedAt ? ` · started ${esc(r.startedAt)}` : ""}${r.error ? ` · ${esc(r.error)}` : ""}. The recorder captures this dashboard's live view once per second.</p>${exports ? `<div class="videos">${exports}</div>` : ""}`;
}

function downloadsPanel(c: CampaignView): string {
  if (!c.downloads.length) return `<p class="empty">No files yet.</p>`;
  const rows = c.downloads
    .map(
      (d) =>
        `<tr><th scope="row">${fileLink(d.path, d.label)}</th><td class="num">${(d.bytes / 1024).toFixed(1)} KB</td><td><code>${d.sha256.slice(0, 16)}</code></td></tr>`,
    )
    .join("");
  return `<div tabindex="0" role="region" aria-label="Evidence files table" class="scroll"><table><caption>Evidence files with their SHA-256</caption><thead><tr><th scope="col">File</th><th scope="col" class="num">Size</th><th scope="col">SHA-256</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function section(id: string, title: string, body: string): string {
  return `<section class="card" id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title">${esc(title)}</h2>${body}</section>`;
}

export function renderMain(c: CampaignView, view: View, inspect: string | null): string {
  if (view === "live")
    return `${alerts(c)}${kpis(c)}<div class="live-grid">
      <div>${section("graph", "Research graph", ledgerGraph(c.ledger, 3))}${section("experiments", "Experiments", experimentsTable(c, true))}</div>
      <div>${section("training", "Training", rewardChart(c.experiments, 200))}${section("messages", "Agent messages", messagesPanel(c, 4))}</div>
    </div>`;
  return `${alerts(c)}${kpis(c)}
    ${section("graph", "Research graph", ledgerGraph(c.ledger) + ledgerList(c))}
    ${section("experiments", "Experiments", experimentsTable(c, false))}
    ${section("training", "Training metrics", rewardChart(c.experiments))}
    ${section("environment", "Environment inspector", inspector(c, inspect, 16))}
    ${section("governance", "Governance", governancePanel(c))}
    ${section("final", "Final evaluation", finalPanel(c))}
    ${section("examples", "Before and after", examplesPanel(c))}
    ${section("messages", "Agent messages", messagesPanel(c, 40))}
    ${section("recording", "Recording", recordingPanel(c))}
    ${section("downloads", "Downloads", downloadsPanel(c))}`;
}

/** Live refresh payload: the header (status pills) and the main content. */
export function renderFragment(c: CampaignView, view: View, inspect: string | null): string {
  return `${header(c)}<!--fragment-->${renderMain(c, view, inspect)}`;
}

export function renderPage(c: CampaignView, view: View, inspect: string | null): string {
  const live =
    c.status === "running" ||
    c.status === "finalizing" ||
    c.status === "waiting" ||
    c.recording.status === "recording";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forge command center</title><style>${CSS}</style></head>
<body class="${view}" data-live="${live}">
<a class="skip" href="#main">Skip to content</a>
${header(c)}
<main id="main" data-view="${view}">${renderMain(c, view, inspect)}</main>
<footer><p>Read from stored files in <code>${esc(c.directory)}</code>${c.updatedAt ? ` · actor snapshot ${esc(c.updatedAt)}` : ""}. The dashboard holds no actor credentials and computes nothing a file does not state.</p></footer>
<script>${CLIENT}</script>
</body></html>`;
}

const CSS = `
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.10);--link:#1c5cab;
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--s6:#008300;--s7:#6250d6;--s8:#e34948;
--good:#0ca30c;--warning:#fab219;--critical:#d03b3b;--good-ink:#006300;--track:#cde2fb;--reserved:#86b6ef;--spent:#2a78d6;--alert-c:#fdeeee;--alert-w:#fff6e0}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink-2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);--link:#86b6ef;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#008300;--s7:#9085e9;--s8:#e66767;--good-ink:#0ca30c;--track:#184f95;--reserved:#3987e5;--spent:#86b6ef;--alert-c:#3a1716;--alert-w:#3a2c0b}}
*{box-sizing:border-box}html{background:var(--page)}
body{margin:0;background:var(--page);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;padding:0 16px 24px}
a{color:var(--link)}code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:8px;background:var(--surface);padding:6px 10px;z-index:9}
.top{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;max-width:1400px;margin:0 auto;padding:16px 0 8px}
h1{font-size:20px;margin:0}.subtitle{margin:2px 0 0;color:var(--ink-2)}.pills{display:flex;gap:8px;flex-wrap:wrap}
main{max-width:1400px;margin:0 auto;display:grid;gap:16px}footer{max-width:1400px;margin:16px auto 0;color:var(--ink-2);font-size:12px}
.status{display:inline-flex;align-items:center;gap:4px;font-weight:600;white-space:nowrap}.status .icon{font-size:12px}
.status.good .icon{color:var(--good)}.status.critical .icon{color:var(--critical)}.status.warning .icon{color:#b88200}.status.active .icon{color:var(--s1)}.status.neutral .icon{color:var(--ink-2)}
.pills>span>.status{border:1px solid var(--border);background:var(--surface);border-radius:999px;padding:3px 10px}
.alert{border-radius:8px;padding:10px 12px;border:1px solid var(--border)}.alert.critical{background:var(--alert-c)}.alert.warning{background:var(--alert-w)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.tile,.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;min-width:0}
.tile h2,.tile h3{font-size:13px;font-weight:600;color:var(--ink-2);margin:0}.kpis.final{margin:10px 0}.tile .value{font-size:28px;font-weight:600;margin:4px 0 0}.tile .of{font-size:14px;color:var(--ink-2);font-weight:400}
.note,.source{color:var(--ink-2);font-size:12px;margin:4px 0 0}.source{display:block}
.card h2{font-size:16px;margin:0 0 10px}.card h3{font-size:14px;margin:0 0 6px}
.meter{display:flex;height:8px;border-radius:4px;background:var(--track);overflow:hidden;margin-top:8px}.meter .spent{background:var(--spent)}.meter .reserved{background:var(--reserved)}
.scroll{overflow-x:auto;max-width:100%}.scroll:focus-visible{outline:2px solid var(--link);outline-offset:2px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}caption{text-align:left;color:var(--ink-2);font-size:12px;padding-bottom:6px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--grid);vertical-align:top}thead th{font-size:12px;color:var(--ink-2);font-weight:600}
.num{text-align:right}th .note{font-weight:400;margin:2px 0 0}.completion,.prediction{font:12px ui-monospace,Menlo,monospace;white-space:pre-wrap;max-width:420px;color:var(--ink-2)}
.swatch{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:baseline}
.swatch.s1,.kind.s1{background:var(--s1);fill:var(--s1)}.swatch.s2,.kind.s2{background:var(--s2);fill:var(--s2)}.swatch.s3,.kind.s3{background:var(--s3);fill:var(--s3)}.swatch.s4,.kind.s4{background:var(--s4);fill:var(--s4)}
.series{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.series.s1{stroke:var(--s1)}.series.s2{stroke:var(--s2)}.series.s3{stroke:var(--s3)}.series.s4{stroke:var(--s4)}.series.s5{stroke:var(--s5)}
.end{stroke:var(--surface);stroke-width:2}.end.s1{fill:var(--s1)}.end.s2{fill:var(--s2)}.end.s3{fill:var(--s3)}.end.s4{fill:var(--s4)}.end.s5{fill:var(--s5)}
.grid{stroke:var(--grid);stroke-width:1}.axis{stroke:var(--axis);stroke-width:1}.crosshair{stroke:var(--axis);stroke-width:1}
.tick,.end-label{fill:var(--ink-2);font-size:12px}.end-label{fill:var(--ink)}
.chart{margin:0}.chart figcaption{color:var(--ink-2);font-size:12px}.legend{display:flex;gap:14px;flex-wrap:wrap;list-style:none;padding:0;margin:6px 0}.legend li{display:flex;align-items:center;gap:6px;font-size:12px}
.plot{position:relative}.plot svg{width:100%;height:auto;display:block}.plot:focus-visible{outline:2px solid var(--link);outline-offset:2px}
.readout{position:absolute;top:4px;right:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px;pointer-events:none}
.readout .row{display:flex;gap:6px;align-items:center}.readout strong{font-variant-numeric:tabular-nums}
.graph svg{display:block}.node rect:first-of-type{fill:var(--surface);stroke:var(--axis)}.edge{fill:none;stroke:var(--axis);stroke-width:1.5}.node-kind{font-size:11px;fill:var(--ink-2)}.node-name{font-size:12px;fill:var(--ink);font-weight:600}
.ledger{padding-left:18px}.ledger li{margin:6px 0}.checks{display:flex;flex-wrap:wrap;gap:4px 16px;list-style:none;padding:0;margin:4px 0}
.review{border-top:1px solid var(--grid);padding-top:10px;margin-top:10px}.review:first-of-type{border-top:0;margin-top:0;padding-top:0}
.videos{display:flex;flex-wrap:wrap;gap:12px}.video{margin:0}.video video{width:320px;max-width:100%;border:1px solid var(--border);border-radius:6px;background:#000}
.empty{color:var(--ink-2)}details summary{cursor:pointer;color:var(--link);margin-top:8px}
.live-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.live-grid>div{display:grid;gap:16px;align-content:start;min-width:0}
body.live{padding-bottom:0}body.live footer{display:none}body.live .kpis .source{display:none}
body.live .top{padding:10px 0 6px}body.live main{gap:12px}body.live .tile{padding:10px 14px}body.live .tile .value{font-size:24px}
body.live .card{padding:10px 14px}body.live .card h2{margin-bottom:6px}body.live .live-grid{gap:12px}body.live .live-grid>div{gap:12px}
body.live .alert{padding:6px 12px}body.live .chart details summary{margin-top:2px}body.live th,body.live td{padding:4px 8px}
@media (max-width:900px){.live-grid{grid-template-columns:1fr}.tile .value{font-size:24px}}
`;

/** Live refresh (the fragment is re-rendered from files) and the chart's crosshair readout. */
const CLIENT = `
(() => {
  const main = document.getElementById("main");
  function wire() {
    for (const plot of document.querySelectorAll(".plot")) {
      const data = JSON.parse(plot.querySelector(".chart-data").textContent);
      const svg = plot.querySelector("svg"), cross = svg.querySelector(".crosshair"), readout = plot.querySelector(".readout");
      let current = null;
      const show = (update) => {
        current = Math.max(1, Math.min(data.maxUpdate, update));
        const x = data.left + ((current - 1) / Math.max(1, data.maxUpdate - 1)) * (data.width - data.left - data.right);
        cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
        readout.replaceChildren();
        const head = document.createElement("div"); head.textContent = "Update " + current; readout.append(head);
        for (const s of data.data) {
          const p = s.points.find((q) => q[0] === current);
          const row = document.createElement("div"); row.className = "row";
          const key = document.createElementNS("http://www.w3.org/2000/svg", "svg"); key.setAttribute("width", "12"); key.setAttribute("height", "6");
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line"); line.setAttribute("class", "series s" + s.slot);
          line.setAttribute("x1", "0"); line.setAttribute("x2", "12"); line.setAttribute("y1", "3"); line.setAttribute("y2", "3"); key.append(line);
          const value = document.createElement("strong"); value.textContent = p ? p[1] + "/" + p[2] : "—";
          const name = document.createElement("span"); name.textContent = s.label;
          row.append(key, value, name); readout.append(row);
        }
        readout.hidden = false;
      };
      plot.addEventListener("pointermove", (event) => {
        const box = svg.getBoundingClientRect(), scale = data.width / box.width;
        const fraction = ((event.clientX - box.left) * scale - data.left) / (data.width - data.left - data.right);
        show(Math.round(1 + fraction * (data.maxUpdate - 1)));
      });
      plot.addEventListener("pointerleave", () => { readout.hidden = true; cross.setAttribute("visibility", "hidden"); });
      plot.addEventListener("focus", () => show(current ?? data.maxUpdate));
      plot.addEventListener("blur", () => { readout.hidden = true; cross.setAttribute("visibility", "hidden"); });
      plot.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft") { show((current ?? 1) - 1); event.preventDefault(); }
        if (event.key === "ArrowRight") { show((current ?? 0) + 1); event.preventDefault(); }
      });
    }
  }
  wire();
  if (document.body.dataset.live !== "true") return;
  let last = "";
  setInterval(async () => {
    try {
      const url = new URL(location.href); url.searchParams.set("fragment", "1");
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return;
      const html = await response.text();
      if (html === last) return;
      const [top, body] = html.split("<!--fragment-->");
      const open = [...main.querySelectorAll("details[open] summary")].map((s) => s.textContent);
      document.querySelector("header.top").outerHTML = top;
      main.innerHTML = body; last = html;
      for (const summary of main.querySelectorAll("details summary")) if (open.includes(summary.textContent)) summary.parentElement.open = true;
      wire();
    } catch {}
  }, 2000);
})();
`;
