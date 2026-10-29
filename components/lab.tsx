"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Agent,
  Artifact,
  Campaign,
  Environment,
  Event,
  Experiment,
  Health,
  TERMINAL,
  View,
  agentNames,
  duration,
} from "@/lib/types";
import { ForgeMark, Icon } from "./icon";
import { Benchmark, LossChart, ResearchGraph } from "./charts";
import { Dialog } from "./dialog";
import { NewCampaign } from "./new-campaign";
import { Results } from "./results";
import { Briefing } from "./briefing";
import { AgentChat } from "./agent-chat";
import { ProductionView } from "./production";
import { TerseView } from "./terse-view";
import {
  ArtifactDetail,
  ArtifactsView,
  Communications,
  ConnectionsView,
  Empty,
  EnvironmentDetail,
  EnvironmentsView,
  ExperimentDetail,
  ExperimentTable,
  GovernanceView,
  PanelHeader,
  Status,
} from "./views";

const navigation: { id: View; label: string; group: string }[] = [
  { id: "briefing", label: "Training briefing", group: "Workspace" },
  { id: "chat", label: "Agent chat", group: "Workspace" },
  { id: "production", label: "Production failures", group: "Workspace" },
  { id: "terse", label: "Durable actors", group: "Workspace" },
  { id: "overview", label: "Overview", group: "Workspace" },
  { id: "experiments", label: "Experiments", group: "Workspace" },
  { id: "environments", label: "Environments", group: "Workspace" },
  { id: "governance", label: "Governance", group: "Workspace" },
  { id: "results", label: "Results", group: "Workspace" },
  { id: "artifacts", label: "Artifacts", group: "Resources" },
  { id: "connections", label: "Connections", group: "Resources" },
];
const descriptions: Record<View, string> = {
  briefing: "The task, the measurements, and what each research role can see.",
  chat: "The research team's real assignments, decisions and handoffs.",
  production:
    "Failures found in real traffic without an answer key, audited against reviewer labels.",
  terse:
    "Read the persisted coordination state and replay versioned training worlds.",
  overview: "Your autonomous research organization, at a glance.",
  experiments: "Every hypothesis, measured against the evidence.",
  environments: "Inspect the worlds behind each model prediction.",
  governance: "Independent oversight with the authority to say no.",
  results:
    "A frozen checkpoint. An independent measurement. The complete evidence.",
  artifacts: "The model, the measurements, and how to reproduce them.",
  connections: "The infrastructure behind the research.",
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const r = await fetch("/api/lab/" + path, { ...options, cache: "no-store" });
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "The request could not be completed.",
    );
  return data;
}

export function Lab() {
  const [view, setView] = useState<View>("briefing"),
    [campaigns, setCampaigns] = useState<Campaign[]>([]),
    [selected, setSelected] = useState(""),
    [campaign, setCampaign] = useState<Campaign | null>(null),
    [events, setEvents] = useState<Event[]>([]),
    [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [newCampaign, setNewCampaign] = useState(false),
    [menu, setMenu] = useState(false),
    [theme, setTheme] = useState("light"),
    [experiment, setExperiment] = useState<Experiment | null>(null),
    [environment, setEnvironment] = useState<Environment | null>(null),
    [artifact, setArtifact] = useState<Artifact | null>(null),
    [agent, setAgent] = useState<Agent | null>(null),
    [dialog, setDialog] = useState(""),
    [probing, setProbing] = useState(false),
    [toast, setToast] = useState("");
  const selectedRef = useRef(selected);
  const refresh = useCallback(async () => {
    try {
      const [h, list] = await Promise.all([
        api<Health>("health"),
        api<Campaign[]>("campaigns"),
      ]);
      setHealth(h);
      setCampaigns(list);
      const id = selectedRef.current || list[0]?.id;
      if (id) {
        const [s, e] = await Promise.all([
          api<Campaign>(`campaigns/${id}`),
          api<Event[]>(`campaigns/${id}/events`),
        ]);
        if (!selectedRef.current) {
          selectedRef.current = id;
          setSelected(id);
        }
        if (selectedRef.current === id) {
          setCampaign(s);
          setEvents(e);
        }
      }
      setError("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not connect to the research engine.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 3500);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    const stored = localStorage.getItem("forge-theme");
    const value = stored || "light";
    document.documentElement.dataset.theme = value;
    requestAnimationFrame(() => setTheme(value));
  }, []);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setDialog("search");
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!menu) return;
    const opener = document.activeElement as HTMLElement | null;
    const nav = document.querySelector<HTMLElement>(".sidebar");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    nav?.querySelector<HTMLButtonElement>(".mobile-close")?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenu(false);
        return;
      }
      if (event.key !== "Tab" || !nav) return;
      const focusable = [
        ...nav.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],select",
        ),
      ].filter((el) => el.getClientRects().length > 0);
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", trap);
      opener?.focus();
    };
  }, [menu]);
  function navigate(v: View) {
    setView(v);
    setMenu(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function selectCampaign(id: string) {
    setSelected(id);
    selectedRef.current = id;
    setLoading(true);
    await refresh();
  }
  function openCampaign(c: Campaign) {
    setSelected(c.id);
    selectedRef.current = c.id;
    setCampaign(c);
    setEvents([]);
    navigate("briefing");
    void refresh();
  }
  function toggleTheme() {
    const value = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = value;
    localStorage.setItem("forge-theme", value);
    setTheme(value);
  }
  async function runProbe() {
    if (!campaign) return;
    setProbing(true);
    try {
      await api(`campaigns/${campaign.id}/probe`, { method: "POST" });
      setToast("Integrity probe rejected. Checkpoint promotion was blocked.");
      await refresh();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Probe failed.");
    } finally {
      setProbing(false);
    }
  }
  async function stopRun() {
    if (!campaign) return;
    try {
      await api(`campaigns/${campaign.id}/cancel`, { method: "POST" });
      setDialog("");
      setToast(
        "Stop requested. The worker will finish its current operation safely.",
      );
      await refresh();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Stop request failed.");
    }
  }
  const live = !!campaign && !TERMINAL.includes(campaign.status);
  const activeExp =
    campaign?.experiments.find((e) =>
      ["training", "evaluating"].includes(e.status),
    ) || campaign?.experiments.at(-1);
  const actualExperiment = experiment
    ? campaign?.experiments.find((e) => e.id === experiment.id) || experiment
    : null;
  const elapsed =
    campaign?.elapsed_seconds ??
    (campaign
      ? Math.max(
          0,
          (Date.parse(campaign.updated_at) - Date.parse(campaign.created_at)) /
            1000,
        )
      : 0);
  const spent =
    campaign?.compute_seconds ?? campaign?.actor?.consumed_seconds ?? 0;
  const rejects =
    campaign?.reviews.filter((r) => r.decision === "rejected").length || 0;
  const report = campaign?.artifacts.find((a) => a.kind === "report");
  const linksHealthy =
    health?.services.terse.connected && health.services.relay.connected;

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to research
      </a>
      {menu && (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <ForgeMark size={29} />
          </span>
          <span>
            forge<span className="brand-period">.</span>
          </span>
          <span className="brand-lab">LAB</span>
          <button
            className="icon-button mobile-close"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="workspace-selector">
          <span className="workspace-icon">F</span>
          <div>
            <strong>Research workspace</strong>
            <span>Autonomous post-training</span>
          </div>
          <Icon name="down" size={14} />
        </div>
        <nav aria-label="Main navigation">
          {["Workspace", "Resources"].map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-group-label">{group}</span>
              {navigation
                .filter((n) => n.group === group)
                .map((n) => (
                  <button
                    key={n.id}
                    aria-label={n.label}
                    onClick={() => navigate(n.id)}
                    className={view === n.id ? "nav-item selected" : "nav-item"}
                    aria-current={view === n.id ? "page" : undefined}
                  >
                    <Icon name={n.id} size={18} />
                    <span>{n.label}</span>
                    {n.id === "experiments" &&
                      !!campaign?.experiments.length && (
                        <span className="nav-count">
                          {campaign.experiments.length}
                        </span>
                      )}
                    {n.id === "governance" && rejects > 0 && (
                      <span className="nav-count warning-count">{rejects}</span>
                    )}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="infra-summary">
            <span className="nav-group-label">RESEARCH INFRASTRUCTURE</span>
            <button onClick={() => navigate("connections")}>
              <span
                className={`static-dot ${health?.services.terse.connected ? "" : "muted-dot"}`}
              />
              <span>Terse</span>
              <small>
                {health?.services.terse.connected ? "Local runtime" : "Offline"}
              </small>
            </button>
            <button onClick={() => navigate("connections")}>
              <span
                className={`static-dot ${health?.services.relay.connected ? "" : "muted-dot"}`}
              />
              <span>Agent Relay</span>
              <small>
                {health?.services.relay.connected ? "Connected" : "Offline"}
              </small>
            </button>
          </div>
          <button className="docs-link" onClick={() => setDialog("docs")}>
            <Icon name="book" size={17} />
            <span>Lab field guide</span>
            <Icon name="external" size={13} />
          </button>
          <div className="sidebar-account">
            <div className="account-avatar">V</div>
            <div>
              <strong>Vir&apos;s workspace</strong>
              <span>Local research session</span>
            </div>
            <button
              className="icon-button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell" inert={menu}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Icon name="menu" />
            </button>
            <span className="breadcrumb-workspace">Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{navigation.find((n) => n.id === view)?.label}</strong>
          </div>
          <div className="topbar-actions">
            {campaign?.recording?.status === "recording" && (
              <span className="capture-status">
                <Icon name="record" size={14} />
                Recording
              </span>
            )}
            <span className="system-status">
              <i className={`static-dot ${linksHealthy ? "" : "muted-dot"}`} />
              {linksHealthy ? "Systems connected" : "Connecting systems"}
            </span>
            <button
              className="search-button"
              onClick={() => setDialog("search")}
              aria-label="Search lab"
            >
              <Icon name="search" size={16} />
              <kbd>⌘ K</kbd>
            </button>
            <span className="topbar-version mono">v0.1</span>
          </div>
        </header>
        <main
          id="main-content"
          className={`main-content ${["briefing", "chat", "production", "terse"].includes(view) ? "briefing-mode" : ""}`}
        >
          <div className="page-heading">
            <div>
              <div className="page-eyebrow">
                <span className="mini-mark">
                  <ForgeMark size={13} />
                </span>{" "}
                AUTONOMOUS POST-TRAINING
              </div>
              <h1>
                {view === "overview"
                  ? "Research overview"
                  : navigation.find((n) => n.id === view)?.label}
              </h1>
              <p>{descriptions[view]}</p>
            </div>
            <div className="heading-actions">
              {campaign && (
                <button className="button" onClick={() => setDialog("replay")}>
                  <Icon name="play" size={15} />
                  <span>Replay trace</span>
                </button>
              )}
              <button
                className="button primary"
                onClick={() => setNewCampaign(true)}
                disabled={live}
              >
                <Icon name="plus" size={17} />
                New campaign
              </button>
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <Icon name="alert" />
              <span>{error}</span>
              <button
                onClick={() => void refresh()}
                className="button small-button"
              >
                Retry
              </button>
            </div>
          )}
          {campaign?.recording?.status === "failed" && (
            <div className="error-banner" role="alert">
              <Icon name="record" />
              <span>
                Screen recording stopped. Research evidence is preserved, but
                this campaign has an incomplete video.
              </span>
            </div>
          )}
          {loading && !campaign ? (
            <div
              className="loading-state"
              aria-label="Loading research workspace"
            >
              <div className="skeleton skeleton-strip" />
              <div className="skeleton-grid">
                <div className="skeleton" />
                <div className="skeleton" />
              </div>
              <span>Connecting to the research engine…</span>
            </div>
          ) : (
            <>
              {campaign && !["connections", "production"].includes(view) && (
                <section
                  className="campaign-bar"
                  aria-label="Current research campaign"
                >
                  <div className="campaign-identity">
                    <div className="campaign-glyph">
                      <Icon name="experiments" size={18} />
                    </div>
                    <div>
                      <label htmlFor="campaign-select">RESEARCH CAMPAIGN</label>
                      <select
                        id="campaign-select"
                        value={selected}
                        onChange={(e) => void selectCampaign(e.target.value)}
                      >
                        {campaigns.map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="campaign-meta">
                    <span>
                      <Icon name="chip" size={14} />
                      Qwen2.5 · 0.5B
                    </span>
                    <span className="meta-divider" />
                    <span>GSM8K subset</span>
                  </div>
                  <div className="campaign-status">
                    <Status value={campaign.status} />
                    {live && (
                      <button
                        className="icon-button stop-button"
                        onClick={() => setDialog("stop")}
                        aria-label="Stop campaign"
                        title="Stop campaign"
                      >
                        <Icon name="stop" size={15} />
                      </button>
                    )}
                  </div>
                </section>
              )}
              {campaign?.error && ["overview", "briefing"].includes(view) && (
                <div className="error-banner" role="status">
                  <Icon name="alert" />
                  <span>{campaign.error}</span>
                  <button
                    className="button small-button"
                    onClick={() => setNewCampaign(true)}
                  >
                    New attempt
                  </button>
                </div>
              )}
              {view === "briefing" ? (
                <Briefing
                  campaign={campaign}
                  events={events}
                  onInspect={setExperiment}
                />
              ) : view === "overview" ? (
                <>
                  {!campaign && (
                    <div className="welcome-strip">
                      <div>
                        <strong>A model. A benchmark. A better result.</strong>
                        <p>
                          Set an objective. Forge runs the experiments and
                          preserves the evidence.
                        </p>
                      </div>
                      <span className="tag">
                        <Icon name="chip" size={14} />
                        Local GPU ready
                      </span>
                    </div>
                  )}
                  <div className="stats-strip">
                    <div>
                      <span>
                        <Icon name="experiments" size={15} />
                        Experiments
                      </span>
                      <strong>
                        {campaign?.experiments.length || "00"}
                        <small>
                          {campaign?.config.max_experiments
                            ? `/ ${campaign.config.max_experiments} planned`
                            : "awaiting a campaign"}
                        </small>
                      </strong>
                    </div>
                    <div>
                      <span>
                        <Icon name="clock" size={15} />
                        Elapsed time
                      </span>
                      <strong>
                        {campaign ? duration(elapsed) : "—"}
                        <small>
                          {live
                            ? "research in progress"
                            : campaign
                              ? "session duration"
                              : "ready when you are"}
                        </small>
                      </strong>
                    </div>
                    <div>
                      <span>
                        <Icon name="chip" size={15} />
                        Compute used
                      </span>
                      <strong>
                        {campaign ? duration(spent) : "—"}
                        <small>
                          {campaign
                            ? `of ${duration(campaign.config.max_seconds)} reserved limit`
                            : "bounded by your budget"}
                        </small>
                      </strong>
                    </div>
                    <div>
                      <span>
                        <Icon name="governance" size={15} />
                        Governance
                      </span>
                      <strong className="stat-governance">
                        {rejects ? (
                          <>
                            <span className="warning-text">{rejects}</span>
                            <small>
                              blocked proposal{rejects === 1 ? "" : "s"}
                            </small>
                          </>
                        ) : (
                          <>
                            <span className="stat-shield">
                              <Icon name="governance" size={23} />
                            </span>
                            <small>
                              {campaign
                                ? "Policy enforced"
                                : "Required for every run"}
                            </small>
                          </>
                        )}
                      </strong>
                    </div>
                  </div>
                  <div className="overview-grid">
                    <section className="panel graph-panel">
                      <PanelHeader
                        title="The research organization"
                        icon="connections"
                        right={
                          <span className="graph-stage">
                            <i className="static-dot" />
                            {live
                              ? "Executing research"
                              : "Persistent by design"}
                          </span>
                        }
                      />
                      <ResearchGraph campaign={campaign} onAgent={setAgent} />
                      <div className="graph-bottom">
                        <span>
                          <Icon name="governance" size={14} />
                          Bounded autonomy. Independent oversight.
                        </span>
                        <button
                          className="text-button"
                          onClick={() => navigate("connections")}
                        >
                          Explore infrastructure
                          <Icon name="arrow" size={14} />
                        </button>
                      </div>
                    </section>
                    <section className="panel benchmark-panel">
                      <PanelHeader
                        title="Benchmark performance"
                        icon="chart"
                        right={<span className="tag">GSM8K</span>}
                      />
                      <Benchmark campaign={campaign} />
                      <div className="benchmark-objective">
                        <span className="eyebrow">Research objective</span>
                        <p>
                          {campaign?.config.objective ||
                            "Improve mathematical reasoning. Prove it on held-out questions."}
                        </p>
                        <span>
                          <Icon name="governance" size={14} />
                          Final test data remains sealed until selection.
                        </span>
                      </div>
                    </section>
                    <section className="panel training-panel">
                      <PanelHeader
                        title="Training telemetry"
                        icon="chart"
                        right={
                          activeExp ? (
                            <span className="mono muted small">
                              {activeExp.id} · {activeExp.metrics.length}/
                              {activeExp.max_steps} STEPS
                            </span>
                          ) : (
                            <span className="tag">Worker telemetry</span>
                          )
                        }
                      />
                      <div className="training-readout">
                        <div>
                          <span className="eyebrow">Training loss</span>
                          <strong>
                            {activeExp?.metrics.at(-1)?.loss.toFixed(3) || "—"}
                            <small>
                              {activeExp?.strategy === "grpo"
                                ? "policy objective"
                                : "cross entropy"}
                            </small>
                          </strong>
                        </div>
                        <div>
                          <span className="chart-key">
                            <i />
                            LoRA training
                          </span>
                          <span className="mono muted small">
                            {activeExp
                              ? `LR ${activeExp.proposal.learning_rate}`
                              : "No active optimizer"}
                          </span>
                        </div>
                      </div>
                      <LossChart metrics={activeExp?.metrics || []} compact />
                      {campaign?.progress && (
                        <div className="training-progress">
                          <div>
                            <span>{campaign.progress.stage}</span>
                            <b className="mono">
                              {campaign.progress.done} /{" "}
                              {campaign.progress.total}
                            </b>
                          </div>
                          <progress
                            value={campaign.progress.done}
                            max={campaign.progress.total}
                          />
                        </div>
                      )}
                    </section>
                    <section className="panel activity-panel">
                      <PanelHeader
                        title="Research activity"
                        icon="clock"
                        right={
                          <span className="mono muted small">UTC TRACE</span>
                        }
                      />
                      <Activity events={events} />
                    </section>
                    <section className="panel experiments-panel">
                      <PanelHeader
                        title="Experiment ledger"
                        icon="experiments"
                        right={
                          <button
                            className="text-button"
                            onClick={() => navigate("experiments")}
                          >
                            View all
                            <Icon name="arrow" size={14} />
                          </button>
                        }
                      />
                      <ExperimentTable
                        campaign={campaign}
                        onSelect={setExperiment}
                        compact
                      />
                    </section>
                    <section className="panel relay-panel">
                      <PanelHeader
                        title="Research communications"
                        icon="message"
                        right={
                          <span className="tag">
                            <i className="static-dot" />
                            Agent Relay
                          </span>
                        }
                      />
                      <Communications events={events} compact />
                    </section>
                  </div>
                  {campaign?.final && (
                    <section
                      className={`final-result ${campaign.final.valid_improvement ? "result-improved" : ""}`}
                    >
                      <div className="final-result-icon">
                        <Icon
                          name={
                            campaign.final.valid_improvement
                              ? "chart"
                              : "governance"
                          }
                          size={30}
                        />
                      </div>
                      <div>
                        <span className="eyebrow">
                          SEALED EVALUATION COMPLETE
                        </span>
                        <h2>
                          {campaign.final.valid_improvement
                            ? `${campaign.final.improvement_pp.toFixed(1)} percentage points. Independently measured.`
                            : "Research complete. No validated improvement claimed."}
                        </h2>
                        <p>
                          {campaign.final.baseline.n} held-out GSM8K questions.
                          Checkpoint selection was frozen before evaluation.
                        </p>
                      </div>
                      {report && (
                        <a
                          className="button primary"
                          href={`/api/lab/campaigns/${campaign.id}/artifacts/${report.id}`}
                        >
                          <Icon name="download" size={16} />
                          Research report
                        </a>
                      )}
                    </section>
                  )}
                </>
              ) : view === "production" ? (
                <ProductionView
                  campaignRunning={live}
                  onCampaign={openCampaign}
                />
              ) : view === "chat" ? (
                <AgentChat
                  key={campaign?.id}
                  campaign={campaign}
                  events={events}
                />
              ) : view === "terse" ? (
                <TerseView
                  key={campaign?.id}
                  campaign={campaign}
                  onSelect={setEnvironment}
                />
              ) : view === "experiments" ? (
                <>
                  <section className="panel">
                    <PanelHeader
                      title="Experiment history"
                      icon="experiments"
                      right={<span className="tag">Development results</span>}
                    />
                    <ExperimentTable
                      campaign={campaign}
                      onSelect={setExperiment}
                    />
                  </section>
                  <section className="panel full-comms">
                    <PanelHeader
                      title="Research communications"
                      icon="message"
                    />
                    <Communications events={events} />
                  </section>
                </>
              ) : view === "environments" ? (
                <EnvironmentsView
                  campaign={campaign}
                  onSelect={setEnvironment}
                />
              ) : view === "governance" ? (
                <GovernanceView
                  campaign={campaign}
                  onProbe={() => void runProbe()}
                  probing={probing}
                />
              ) : view === "results" ? (
                <Results campaign={campaign} />
              ) : view === "artifacts" ? (
                <ArtifactsView campaign={campaign} onArtifact={setArtifact} />
              ) : (
                <ConnectionsView health={health} />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <ForgeMark size={14} />
              Research that leaves a paper trail.
            </span>
            <span>
              {campaign ? (
                <>
                  <span className="mono">{campaign.id}</span>
                  <span className="footer-dot">·</span>
                  {campaign.recording?.status === "recording" ? (
                    <span className="warning-text">
                      <Icon name="record" size={12} />
                      Recording active
                    </span>
                  ) : campaign.recording?.status === "saved" ? (
                    <span>Screen recording saved</span>
                  ) : (
                    <span>Screen capture not active</span>
                  )}
                </>
              ) : (
                <span>Local-first · verifiable by design</span>
              )}
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Icon name="info" size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {newCampaign && (
        <NewCampaign
          health={health}
          onClose={() => setNewCampaign(false)}
          onCreated={(c) => {
            setNewCampaign(false);
            openCampaign(c);
          }}
        />
      )}
      {actualExperiment && (
        <ExperimentDetail
          experiment={actualExperiment}
          campaign={campaign}
          onClose={() => setExperiment(null)}
        />
      )}
      {environment && (
        <EnvironmentDetail
          environment={environment}
          onClose={() => setEnvironment(null)}
        />
      )}
      {artifact && campaign && (
        <ArtifactDetail
          artifact={artifact}
          campaign={campaign}
          onClose={() => setArtifact(null)}
        />
      )}
      {agent && (
        <Dialog
          title={agentNames[agent]}
          subtitle={
            agent === "governance" ? "Independent authority" : "Research team"
          }
          onClose={() => setAgent(null)}
          drawer
        >
          <p className="hypothesis">
            {
              {
                director:
                  "Selects bounded experiments from real development failures and previous results.",
                data: "Supplies permitted, versioned training data and keeps development and test questions separate.",
                trainer:
                  "Executes actual LoRA optimization and saves weights, metrics, and configuration.",
                evaluator:
                  "Independently reloads checkpoints, scores predictions, and checks declared regressions.",
                governance:
                  "Enforces immutable policy, rejects invalid evidence, and gates checkpoint promotion.",
              }[agent]
            }
          </p>
          <div className="detail-section">
            <span className="eyebrow">Recent communications</span>
            <Communications
              events={events.filter(
                (e) => e.agent === agent || e.recipient === agent,
              )}
              compact
            />
          </div>
          {agent === "director" && (
            <p className="chart-note">
              {campaign?.director || health?.services.director.mode} ·{" "}
              {health?.services.director.model}
            </p>
          )}
        </Dialog>
      )}
      {dialog === "stop" && (
        <Dialog
          title="Stop this campaign?"
          subtitle="Completed evidence will be preserved."
          onClose={() => setDialog("")}
        >
          <p className="dialog-copy">
            The worker will stop at the next safe boundary and release its
            compute reservation. An unverified checkpoint will not be promoted.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setDialog("")}>
              Keep researching
            </button>
            <button
              className="button danger-button"
              onClick={() => void stopRun()}
            >
              <Icon name="stop" size={16} />
              Stop campaign
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "docs" && (
        <Dialog
          title="The Forge field guide"
          subtitle="A model, a benchmark, and compute. Evidence for every step."
          onClose={() => setDialog("")}
          wide
        >
          <div className="field-guide">
            <h3>01 / Define the research</h3>
            <p>
              Launch a campaign with an objective, an experiment count and a
              compute time limit. The initial supported model is
              Qwen2.5-0.5B-Instruct. Runs execute on the local GPU.
            </p>
            <h3>02 / Follow real experiments</h3>
            <p>
              The director diagnoses measured development failures and selects
              supervised LoRA strategies. Agent Relay carries assignments and
              findings. Terse persists the objective, experiments, reservations,
              worlds and reviews.
            </p>
            <h3>03 / Trust the evidence</h3>
            <p>
              Weights must change, the saved adapter must reload independently,
              and deterministic governance checks must pass. A final test subset
              is evaluated once after checkpoint selection freezes. Forge can
              conclude without an improvement.
            </p>
            <h3>04 / Reproduce the result</h3>
            <p>
              Download the checkpoint bundle, report and trace from Artifacts.
              The adapter needs its pinned Qwen base model. Dataset revisions,
              train/dev IDs, seeds, prompts, predictions and weight hashes are
              preserved.
            </p>
            <div className="inline-notice">
              <Icon name="info" />
              <span>
                The current release uses SFT and a disclosed GSM8K subset with a
                custom numeric scorer. The full official benchmark harness,
                broad safety testing and cloud GPU scheduling are not enabled.
              </span>
            </div>
          </div>
        </Dialog>
      )}
      {dialog === "replay" && campaign && (
        <TraceReplay
          events={events}
          campaign={campaign}
          onClose={() => setDialog("")}
        />
      )}
      {dialog === "search" && (
        <SearchDialog
          onClose={() => setDialog("")}
          onNavigate={(v) => {
            navigate(v);
            setDialog("");
          }}
          campaign={campaign}
          onExperiment={(e) => {
            setDialog("");
            setExperiment(e);
          }}
        />
      )}
    </div>
  );
}

function Activity({ events }: { events: Event[] }) {
  const rows = events
    .filter((e) =>
      ["stage", "review", "artifact", "blocked", "error"].includes(e.kind),
    )
    .slice(-4)
    .reverse();
  return rows.length ? (
    <div className="activity-list">
      {rows.map((e) => (
        <div key={e.id}>
          <span
            className={`activity-icon ${e.kind === "blocked" || e.kind === "error" ? "warning-text" : ""}`}
          >
            <Icon
              name={
                e.kind === "review" || e.kind === "blocked"
                  ? "governance"
                  : e.kind === "artifact"
                    ? "artifacts"
                    : e.kind === "error"
                      ? "alert"
                      : "experiments"
              }
              size={15}
            />
          </span>
          <div>
            <p>{e.text}</p>
            <time className="mono">
              {new Date(e.timestamp).toLocaleTimeString("en-GB", {
                timeZone: "UTC",
              })}{" "}
              UTC
            </time>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <Empty
      icon="clock"
      title="The next discovery starts here"
      description="Decisions and meaningful milestones will appear in this persistent trace."
    />
  );
}
function TraceReplay({
  events,
  campaign,
  onClose,
}: {
  events: Event[];
  campaign: Campaign;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState(0),
    [playing, setPlaying] = useState(false);
  const rows = events.filter((e) => e.kind !== "message_pending");
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setCursor((c) => Math.min(c + 1, rows.length)),
      350,
    );
    return () => clearInterval(timer);
  }, [playing, rows.length]);
  const complete = cursor >= rows.length;
  return (
    <Dialog
      title="Replay the research trace"
      subtitle="Historical events. No training or actor state is changed."
      onClose={onClose}
      wide
    >
      <div className="replay-toolbar">
        <button
          className="button"
          onClick={() => {
            if (complete) setCursor(0);
            setPlaying((p) => !p);
          }}
        >
          <Icon name={playing && !complete ? "stop" : "play"} size={15} />
          {playing && !complete ? "Pause" : "Play trace"}
        </button>
        <span className="mono muted">
          {cursor} / {rows.length} EVENTS
        </span>
        <a
          className="button small-button"
          href={`/api/lab/campaigns/${campaign.id}/trace`}
        >
          <Icon name="download" size={15} />
          Export
        </a>
      </div>
      <label className="replay-slider">
        Trace position
        <input
          aria-label="Trace position"
          type="range"
          min="0"
          max={rows.length}
          value={cursor}
          onChange={(e) => {
            setPlaying(false);
            setCursor(Number(e.target.value));
          }}
        />
      </label>
      <div className="trace-terminal" role="log">
        {cursor === 0 ? (
          <span className="muted">
            Ready to replay the recorded research events.
          </span>
        ) : (
          rows.slice(Math.max(0, cursor - 12), cursor).map((e) => (
            <div key={e.id}>
              <time>
                {new Date(e.timestamp).toLocaleTimeString("en-GB", {
                  timeZone: "UTC",
                })}
              </time>
              <b>{e.agent}</b>
              <span>{e.text}</span>
            </div>
          ))
        )}
      </div>
    </Dialog>
  );
}
function SearchDialog({
  onClose,
  onNavigate,
  campaign,
  onExperiment,
}: {
  onClose: () => void;
  onNavigate: (v: View) => void;
  campaign: Campaign | null;
  onExperiment: (e: Experiment) => void;
}) {
  const [q, setQ] = useState("");
  return (
    <Dialog title="Find your way around the lab" onClose={onClose}>
      <label className="search-field command-search">
        <Icon name="search" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search views or experiments…"
          aria-label="Search lab"
          autoFocus
        />
      </label>
      <div className="command-results">
        {navigation
          .filter((n) => n.label.toLowerCase().includes(q.toLowerCase()))
          .map((n) => (
            <button key={n.id} onClick={() => onNavigate(n.id)}>
              <Icon name={n.id} />
              <span>{n.label}</span>
              <Icon name="arrow" size={15} />
            </button>
          ))}
        {campaign?.experiments
          .filter((e) =>
            `${e.id} ${e.strategy}`.toLowerCase().includes(q.toLowerCase()),
          )
          .map((e) => (
            <button key={e.id} onClick={() => onExperiment(e)}>
              <Icon name="experiments" />
              <span>{e.id}</span>
              <Status value={e.status} />
            </button>
          ))}
      </div>
    </Dialog>
  );
}
