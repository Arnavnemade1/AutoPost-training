// Real data from campaign forge-e84925eb, copied from the run's own files (read-only):
// artifacts/forge-e84925eb/events.jsonl, final-evaluation.json, report.json,
// data/production/scan-b1b36ecf.json and data/chaos/incidents.json.

export const CAMPAIGN = "forge-e84925eb";
export const SCAN = "scan-b1b36ecf";

/** exp-001 training loss, steps 1 to 96 (events.jsonl "metric"). The runtime was killed after step 76. */
export const LOSS = [
  0.4429, 0.6407, 0.8065, 0.6747, 0.5661, 0.7625, 0.3734, 0.6591, 0.5867,
  0.4861, 0.4565, 0.5998, 0.8453, 0.4141, 0.5478, 0.8212, 0.6998, 0.5881,
  0.3364, 0.7845, 0.7661, 0.5281, 0.4629, 0.6412, 0.5106, 1.411, 0.3024, 0.6292,
  0.3048, 0.1598, 0.8677, 0.2196, 0.4778, 0.344, 1.3852, 0.6713, 0.3262, 0.2411,
  0.1393, 0.3567, 0.444, 0.3431, 0.5201, 0.6445, 0.3371, 0.4128, 0.6704, 0.5012,
  0.6207, 0.4696, 0.8152, 0.1838, 0.3591, 0.2727, 0.4161, 0.461, 0.4003, 0.7729,
  0.6451, 0.5041, 1.1746, 0.4108, 0.3765, 0.6862, 0.4117, 0.4175, 0.2644,
  0.7988, 0.4118, 0.2108, 0.3199, 0.5888, 0.5869, 0.3717, 0.3079, 0.7323,
  0.4433, 0.8953, 0.548, 0.4031, 0.7762, 0.5723, 0.3453, 0.1987, 0.5476, 0.2813,
  0.2977, 0.8994, 0.5241, 0.9107, 0.5529, 0.4875, 0.4077, 0.379, 0.768, 0.3126,
];
export const KILLED_AFTER_STEP = 76;

/** Six of the 62 flagged answers (scan-b1b36ecf findings), question shortened. */
export const FLAGGED = [
  {
    id: "live-5282",
    question:
      "Willie came back from Europe with 70 euros. Normally 5 euros is\u2026",
    signals: ["No final answer", "Cut off"],
  },
  {
    id: "live-7180",
    question:
      "Fred was having a party and was responsible for buying canned\u2026",
    signals: ["No final answer", "Cut off"],
  },
  {
    id: "live-3613",
    question:
      "The balance of Pam's bank account tripled during the year. At\u2026",
    signals: ["Miscalculation", "No final answer", "Cut off"],
  },
  {
    id: "live-3747",
    question: "A math teacher had $100 to buy three different types of\u2026",
    signals: ["No final answer"],
  },
  {
    id: "live-2356",
    question:
      "Betty bought 1 kg of oranges and 3 kg of apples. The total cost\u2026",
    signals: ["No final answer"],
  },
  {
    id: "live-2393",
    question: "Robbie weighs 100 pounds. Patty was 4.5 times as heavy as\u2026",
    signals: ["No final answer", "Cut off"],
  },
];

export const SCAN_STATS = {
  traces: 64,
  flagged: 62,
  actuallyWrong: 63,
  truePositives: 62,
  precision: "100.0%",
  recall: "98.4%",
};
export const DETECTORS = [
  { name: "No final answer", count: 62 },
  { name: "Cut off at the length limit", count: 38 },
  { name: "Miscalculation", count: 1 },
  { name: "User correction", count: 0 },
];

export type Role = "data" | "director" | "trainer" | "evaluator" | "governance";
export const ROLES: Record<Role, { name: string; initials: string }> = {
  data: { name: "Data researcher", initials: "DR" },
  director: { name: "Research director", initials: "RD" },
  trainer: { name: "Training engineer", initials: "TE" },
  evaluator: { name: "Experiment evaluator", initials: "EV" },
  governance: { name: "Governance council", initials: "GC" },
};

export type Message = {
  from: Role;
  to: Role | "room";
  route: "Direct message" | "Research room" | "Thread reply";
  category: string;
  time: string;
  text: string;
  receipt?: string;
};

/** Verbatim Agent Relay messages (events.jsonl kind "message"). */
export const MESSAGES: Message[] = [
  {
    from: "data",
    to: "director",
    route: "Direct message",
    category: "PRODUCTION_FAILURES_TRIAGED",
    time: "00:25:13",
    text: "62 of 64 production answers flagged (1 arithmetic slip, 62 missing final answer, 38 truncated). 28 labeled failures join training; 33 are held out to measure the fix.",
    receipt: "Read by Research director",
  },
  {
    from: "director",
    to: "room",
    route: "Research room",
    category: "EXPERIMENT_PROPOSED",
    time: "00:28:39",
    text: "Reweighting the labeled production failures will reduce missing final answers and truncation on held-out production failures by teaching the model to complete responses with an explicit final answer; it may also reduce arithmetic slips in those examples.",
    receipt: "Read by 4",
  },
  {
    from: "trainer",
    to: "room",
    route: "Research room",
    category: "CHECKPOINT_SAVED",
    time: "00:29:22",
    text: "exp-001 checkpoint is ready for independent review. SHA-256 15e585f199e9cec5.",
    receipt: "Read by 4",
  },
  {
    from: "evaluator",
    to: "director",
    route: "Direct message",
    category: "EVALUATION_COMPLETED",
    time: "00:31:34",
    text: "exp-001: 8/24 development answers correct. Review approved. Held-out production failures now correct: 9/33 (baseline 0/33).",
    receipt: "Read by Research director",
  },
  {
    from: "governance",
    to: "room",
    route: "Thread reply",
    category: "CHECKPOINT_VERDICT",
    time: "00:31:34",
    text: "Approved for promotion. Integrity, regression and provenance checks passed for exp-001.",
    receipt: "Read by 4",
  },
];

/** GSM8K test-885 from final-evaluation.json, verbatim. */
export const EXAMPLE = {
  id: "test-885",
  question:
    "The Ben and Aggie Burrito Shop makes 125 chimichangas on Tuesdays, 125 chimichangas on Wednesdays and twice as many on Friday. How many chimichangas do they make on those three days?",
  before:
    "To determine how many chimichangas the Ben and Aggie Burrito Shop makes on each of the three days (Tuesday, Wednesday, and Friday), we can follow these steps:\n\n1. Identify the number of chimichangas made on Tuesday.\n   - The shop makes 125 chimichangas on Tuesday.\n\n2. Identify the number of chimichangas made on Wednesday.\n   - The shop makes twice as many chimichangas on Wednesday as it does on Tuesday.\n   - Therefore, the number of chimichangas made on Wednesday is \\(2 \\times 125 = 250\\).\n\n3. Identify the number of chimichangas made on Friday.\n   - The shop makes 125 chimichangas on Friday.\n\n4. Sum up the total number of chimichangas made over the three days.\n   - Total chimichangas = Chimbachamas on Tuesday + Chimbachamas on Wednesday + Chimbachamas on Friday\n   - Total chimichangas = 125 + 250 + 125\n\nNow, let's perform the addition:\n\\[125 + 250 = 375\\]\n\\[",
  after:
    "On Tuesday, they make 125.\nOn Wednesday, they make 125.\nOn Friday, they make twice as many as on Tuesday, which is 2*125 = <<125*2=250>>250.\nIn total, they make 125+125+250 = <<125+125+250=500>>500 chimichangas.\n#### 500",
};

/** data/chaos/incidents.json, the crash test during exp-001 training. */
export const CRASH = {
  killedPid: 87701,
  restartedPid: 98624,
  killedAt: "00:28:50",
  processBack: 1.9,
  fenced: 26.4,
  back: 28.3,
  resumed: 0.6,
  actors: [
    "ResearchCampaignActor",
    "GovernanceActor",
    "ArtifactRegistryActor",
    "ExperimentActor",
  ],
  budgetSettled: "198.7 s",
  attempts: 24,
};

export const RESULTS = {
  production: {
    before: 0,
    after: 9,
    n: 33,
    pp: "+27.3",
    ci: ["+12.1", "+42.4"],
  },
  sealed: { before: 1, after: 6, n: 24, pp: "+20.8", ci: ["+4.2", "+37.5"] },
};

/** report.json snapshot experiments and reviews. */
export const EXPERIMENTS = [
  {
    id: "exp-001",
    method: "Targeted fine-tuning",
    lr: "0.0002",
    dev: "8/24",
    change: "+33.3 pp",
    heldOut: "9/33",
    verdict: "Promoted",
  },
  {
    id: "exp-002",
    method: "Targeted fine-tuning",
    lr: "0.0001",
    dev: "7/24",
    change: "+29.2 pp",
    heldOut: "11/33",
    verdict: "Kept on record",
  },
];
export const REVIEWS = [
  { title: "Experiment preflight", target: "exp-001", time: "00:28:39" },
  { title: "Checkpoint review", target: "exp-001", time: "00:31:34" },
  { title: "Experiment preflight", target: "exp-002", time: "00:31:41" },
  { title: "Checkpoint review", target: "exp-002", time: "00:34:23" },
];
