export type View =
  | "briefing"
  | "chat"
  | "production"
  | "terse"
  | "overview"
  | "experiments"
  | "environments"
  | "governance"
  | "results"
  | "artifacts"
  | "connections";
export type ResultFilter = "all" | "improved" | "regressed";
export type Agent =
  | "director"
  | "data"
  | "trainer"
  | "evaluator"
  | "governance";
export type Prediction = {
  id: string;
  question: string;
  output: string;
  answer: string;
  expected: string;
  correct: boolean;
  environment_id?: string;
};
export type Evaluation = {
  score: number;
  n: number;
  correct: number;
  ci95: number[];
  predictions: Prediction[];
  split: string;
  seconds: number;
  dataset_revision: string;
  scoring: string;
  decoding: { max_new_tokens: number; do_sample: boolean };
};
export type Metric = {
  step: number;
  loss: number;
  elapsed: number;
  learning_rate: number;
};
export type Review = {
  id: string;
  decision: "approved" | "rejected";
  reason_codes: string[];
  timestamp: string;
  evidence: Record<string, unknown>;
  policy_version: string;
};
export type Experiment = {
  id: string;
  strategy: string;
  hypothesis: string;
  status: string;
  created_at: string;
  max_steps: number;
  metrics: Metric[];
  proposal: {
    learning_rate: number;
    lora_rank: number;
    focus: string;
    director: string;
  };
  evaluation?: Evaluation;
  production?: Evaluation | null;
  review?: Review;
  training?: {
    weights_changed: boolean;
    sha256: string;
    before_hash: string;
    after_hash: string;
    seconds: number;
  };
};
export type Artifact = {
  id: string;
  name: string;
  kind: string;
  path: string;
  sha256: string;
  bytes: number;
  created_at: string;
};
export type Environment = {
  id: string;
  episode_id: string;
  task: string;
  seed: number;
  version: number;
  terminated: boolean;
  reward: number | null;
  actions: { action_id: string; answer: string; reward: number }[];
  reward_version: string;
  checksum: string;
};
export type Config = {
  name: string;
  objective: string;
  model_id: string;
  benchmark: string;
  max_seconds: number;
  train_steps: number;
  max_experiments: number;
  dev_samples: number;
  final_samples: number;
  seed: number;
  strategies: string[];
};
export type Campaign = {
  briefing?: {
    as_of: string;
    phase: string;
    experiment_number: number;
    experiment_limit: number;
    experiment_id: string | null;
    strategy: string | null;
    hypothesis: string | null;
    progress?: { stage: string; done: number; total: number };
    director: {
      input_recorded: boolean;
      failure_examples: number | null;
      previous_results: number | null;
      development_score_seen: number | null;
      final_test_data_provided: boolean;
    };
    oversight: {
      decision: string;
      decision_scope: string;
      checks: { label: string; state: string }[];
      blocked_proposals: number;
      last_block: Review | null;
      regression_scope: string;
    };
    execution: {
      terse_worlds: number;
      rl_rollouts: number;
      relay_deliveries: number;
      settled_compute_seconds: number;
      time_limit_seconds: number;
    };
  };
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  config: Config;
  director?: string;
  experiments: Experiment[];
  reviews: Review[];
  artifacts: Artifact[];
  environments: Environment[];
  baseline?: Evaluation;
  best?: {
    id: string;
    evaluation: Evaluation;
    sha256: string;
    production?: Evaluation | null;
  };
  final?: {
    baseline: Evaluation;
    checkpoint: Evaluation;
    improvement_pp: number;
    checkpoint_id: string;
    valid_improvement: boolean;
    production?: ProductionVerdict;
  };
  production?: CampaignProduction;
  production_baseline?: Evaluation;
  actor?: {
    consumed_seconds: number;
    reservations: Record<string, { seconds: number; status: string }>;
    selection_frozen: boolean;
    best_checkpoint: string | null;
  };
  progress?: { stage: string; done: number; total: number };
  elapsed_seconds?: number;
  compute_seconds?: number;
  error?: string;
  cancel_requested?: boolean;
  recording?: { status: string };
};
export type RelayDelivery = {
  role: Agent;
  delivery_id: string | null;
  state: string;
  read_at: string | null;
  source: "inbox" | "readback";
};
export type RelayReaction = { emoji: string; count: number; agents: Agent[] };
export type Event = {
  id: string;
  timestamp: string;
  kind: string;
  text: string;
  agent: Agent;
  recipient?: Agent;
  category?: string;
  /** Forge message ID; message_pending carries it inside `message`. */
  message_id?: string;
  message?: {
    id: string;
    recipient?: Agent;
    route?: "dm" | "room";
    category?: string;
  };
  relay_id?: string;
  route?: "dm" | "room" | "thread";
  thread_parent_id?: string | null;
  emoji?: string;
  reactions?: RelayReaction[];
  receipt?: {
    delivered: boolean;
    recipient_readback_verified: boolean;
    route?: "dm" | "room" | "thread";
    conversation_id?: string | null;
    woke_by?: "push" | "inbox-sweep";
    deliveries?: RelayDelivery[];
    read_by?: { name: Agent; read_at: string | null }[];
    room?: {
      name: string;
      id: string;
      /** Earlier receipts copied every DM into the room. */
      message_id?: string;
      readback_verified?: boolean;
      readers?: Agent[];
    };
  };
  experiment_id?: string;
  metric?: Metric;
};
export type Health = {
  ok: boolean;
  worker: string;
  version: string;
  services: Record<
    string,
    {
      connected: boolean;
      mode: string;
      model?: string;
      transport?: string;
      endpoint?: string;
    }
  >;
};
export const TERMINAL = ["completed", "failed", "cancelled", "interrupted"];
export const agentNames: Record<Agent, string> = {
  director: "Research director",
  data: "Data researcher",
  trainer: "Training engineer",
  evaluator: "Experiment evaluator",
  governance: "Governance council",
};
export const strategyName = (s: string) =>
  s === "grpo" ? "GRPO" : s === "targeted_sft" ? "Targeted SFT" : "Broad SFT";
export const percent = (n?: number) =>
  n === undefined ? "—" : `${(n * 100).toFixed(1)}%`;
export const duration = (s: number) =>
  s < 60
    ? `${Math.round(s)}s`
    : s < 3600
      ? `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`
      : `${(s / 3600).toFixed(2)}h`;

export type DetectorKind =
  | "arithmetic_slip"
  | "missing_final_answer"
  | "truncated"
  | "user_reported";
export type DetectorAudit = {
  labeled: number;
  actually_wrong: number;
  true_positives: number;
  false_positives: number;
  missed: number;
  precision: number | null;
  recall: number | null;
};
export type DetectorCategory = {
  kind: DetectorKind;
  label: string;
  count: number;
};
export type ProductionTrace = {
  id: string;
  prompt: string;
  output: string;
  finish_reason: string | null;
  feedback?: { rating?: number; correction?: string };
  timestamp?: string;
};
export type ProductionSignal = {
  kind: DetectorKind;
  evidence: {
    equation?: string;
    computed?: string;
    tail?: string;
    finish_reason?: string;
    rating?: number;
    correction?: string;
  };
};
export type ProductionScanSummary = {
  id: string;
  name: string;
  created_at: string;
  source: "simulated" | "upload";
  source_sha256: string;
  traces: number;
  flagged: number;
  malformed: number;
  excluded_sealed_overlap: string[];
  categories: DetectorCategory[];
  audit: DetectorAudit | null;
};
export type ProductionScan = Omit<ProductionScanSummary, "malformed"> & {
  malformed: { line: number; reason: string }[];
  findings: { trace: ProductionTrace; signals: ProductionSignal[] }[];
};
export type ImprovementClaim = "validated" | "uncertain" | "none";
export type ProductionVerdict = {
  baseline: { correct: number; n: number };
  checkpoint: { correct: number; n: number };
  fixed_ids: string[];
  improvement_pp: number;
  paired_bootstrap_95_pp: number[];
  improved_examples: number;
  regressed_examples: number;
  improvement_claim: ImprovementClaim;
  valid_improvement: boolean;
};
export type CampaignProduction = {
  scan_id: string;
  name: string;
  traces: number;
  flagged: number;
  categories: DetectorCategory[];
  audit: DetectorAudit | null;
  train: { id: string; trace_id: string; kinds: DetectorKind[] }[];
  held_out: {
    id: string;
    trace_id: string;
    kinds: DetectorKind[];
    question: string;
  }[];
};
