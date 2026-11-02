#!/usr/bin/env node
/**
 * One-shot generator for Task 10 gate + scribe eval fixtures.
 * Run: node scripts/generate-t10-eval-fixtures.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function normalize(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

const forbidden = new Set();
for (const f of [
  path.join(root, "src/lib/server/gate/seed-examples.json"),
  ...readdirSync(path.join(root, "evals/gate"))
    .filter((x) => x.endsWith(".json"))
    .map((x) => path.join(root, "evals/gate", x)),
]) {
  const data = JSON.parse(readFileSync(f, "utf8"));
  for (const row of Array.isArray(data) ? data : [data]) {
    if (row.text) forbidden.add(normalize(row.text));
  }
}

const TASK_TYPES = [
  "hypothesis_generation",
  "experiment_design",
  "literature_review",
  "critique",
  "results_interpretation",
  "factual_lookup",
  "chat",
  "formatting",
  "summarize_single",
  "repo_status",
  "code_help",
  "planning_admin",
  "other",
];

/** Ambiguous phrasing templates per task type (boundary-heavy). */
const HARD_TEMPLATES = {
  hypothesis_generation: [
    "Could {topic} explain the variance we saw — list competing stories, not an experiment yet",
    "Brainstorm rival mechanisms for {topic}; I'm not asking for a protocol",
    "What might cause {topic}? Hypotheses only, don't design a study",
    "Speculative: {topic} — what are distinct causal hypotheses?",
    "I'm torn on explanations for {topic}; propose hypotheses, not methods",
    "Rival accounts for {topic}? Keep it conjecture-level",
    "Generate competing hypotheses about {topic} without sampling plans",
    "Why might {topic} happen? Hypothesis menu, not an RCT outline",
    "Theory-building: {topic} — enumerate hypotheses, skip power analysis",
    "Unclear mechanism for {topic}; hypothesis brainstorm requested",
    "Not sure if {topic} is confounding or causal — hypothesis ideas?",
    "What could underlie {topic}? Competing hypotheses welcome",
  ],
  experiment_design: [
    "Design a study to test {topic} — controls, n, and endpoints",
    "Protocol sketch: how would we experimentally isolate {topic}?",
    "Power and randomization plan for {topic}, not literature summary",
    "Experimental manipulation to test {topic}; include blinding if relevant",
    "Two-arm design comparing {topic}; specify primary outcome",
    "Pre-registerable protocol for {topic} with exclusion criteria",
    "How should we run an ablation experiment on {topic}?",
    "Sample size and blocking strategy for {topic} lab study",
    "Draft methods section experiment for {topic}",
    "Operationalize {topic} into measurable variables in a study design",
    "Pilot experiment plan for {topic} with stopping rules",
    "Within-subjects design proposal for {topic}",
  ],
  literature_review: [
    "Survey papers on {topic} since 2018 — synthesis, not a single DOI lookup",
    "What does the literature say about {topic}? Thematic review",
    "Compare major approaches to {topic} across publications",
    "Narrative review outline for {topic} with key citations",
    "Map the evidence landscape on {topic}; not just one fact",
    "Systematic-style scan: {topic} in ML/NLP venues",
    "Prior work on {topic}: trends and gaps for a related-work section",
    "Literature synthesis on {topic} for our intro chapter",
    "Which papers define {topic}? Review-level, not trivia",
    "State of the art summary for {topic} from published work",
    "Coverage of {topic} in peer-reviewed sources — overview",
    "Related work paragraph sources for {topic}",
  ],
  critique: [
    "What's weak about the {topic} claim in our draft?",
    "Methodological flaws in the {topic} argument — be harsh",
    "Peer-review style critique of {topic} section",
    "Identify limitations and threats to validity for {topic}",
    "Why reviewers might reject the {topic} framing",
    "Attack the {topic} evidence chain — logical gaps",
    "Weaknesses in how we justify {topic}",
    "Critical reading of {topic} assumptions",
    "What would a skeptical reviewer say about {topic}?",
    "Problems with the {topic} experimental claims",
    "Critique the {topic} statistical story",
    "Flaws in our {topic} narrative, not new results",
  ],
  results_interpretation: [
    "Table shows {topic} — what does it mean for our claim?",
    "Interpret the {topic} outcome we measured yesterday",
    "We got {topic} in the run — implications?",
    "How to read the {topic} effect size in context",
    "Explain what the {topic} numbers imply (results already in hand)",
    "Discussion paragraph for {topic} finding",
    "Does {topic} support or undermine H1? Results interpretation",
    "Meaning of the {topic} CI crossing zero",
    "Post-hoc interpretation of {topic} ablation outcome",
    "Translate {topic} metric shift into scientific takeaway",
    "Our logged {topic} delta — interpret, don't redesign study",
    "What story do the {topic} plots tell?",
  ],
  factual_lookup: [
    "What is the DOI for the paper titled {topic}?",
    "Who authored the canonical {topic} benchmark paper?",
    "Publication year of the original {topic} work?",
    "Exact citation for {topic} — need the reference string",
    "What's the arXiv id for {topic}?",
    "Lookup: first author of {topic} Nature paper",
    "Factual: venue where {topic} was published",
    "Retrieve bibliographic metadata for {topic}",
    "Which journal published {topic}?",
    "Find the official title of the {topic} dataset paper",
    "What license does the {topic} code release use? (cite source)",
    "How many citations does {topic} have on OpenAlex?",
  ],
  chat: [
    "Hey — quick check-in about {topic} before coffee",
    "Thanks for helping with {topic} yesterday, casual question",
    "lol the {topic} plot looks wild, just chatting",
    "Good morning — any thoughts on {topic}? (no deliverable)",
    "Off-topic: {topic} reminded me of a podcast",
    "Friendly ping about {topic}, not a research task",
    "Small talk: how's {topic} going on your end?",
    "Just venting about {topic} debugging frustration",
    "Appreciate the {topic} help — general chit-chat follow-up",
    "Random: favorite paper on {topic}? conversational",
    "Checking in — no rush on {topic}",
    "Banter about {topic} conference hallway vibes",
  ],
  formatting: [
    "Reformat the {topic} list into APA references only",
    "Convert {topic} bullet notes to numbered outline — formatting only",
    "Fix markdown headings in the {topic} section",
    "Make the {topic} table LaTeX-ready, no new analysis",
    "Clean up whitespace and cite keys in {topic} draft",
    "Turn {topic} sentences into passive voice for the paper",
    "Apply our house style to {topic} paragraph",
    "Reorder {topic} sections per template — cosmetic edit",
    "Normalize notation for {topic} symbols in text",
    "Pretty-print the {topic} JSON config snippet",
    "Bullet list to prose for {topic} appendix — format task",
    "Indent and capitalize {topic} methods list consistently",
  ],
  summarize_single: [
    "TL;DR the attached {topic} abstract in 3 bullets",
    "Summarize this one {topic} paragraph for slack",
    "Short summary of the {topic} section I pasted",
    "One-paragraph recap of {topic} intro only",
    "Condense {topic} email thread into key points",
    "Summarize the {topic} figure caption text",
    "Brief summary of single {topic} blog post",
    "Executive summary of {topic} one-pager",
    "Summarize {topic} methods blurb — no critique",
    "Digest the {topic} changelog entry",
    "Summarize one {topic} reviewer comment",
    "Quick summary of {topic} slide notes",
  ],
  repo_status: [
    "What's the git status of {topic} branch?",
    "Any uncommitted changes in {topic} repo?",
    "Did CI pass on {topic} last commit?",
    "Show open PRs touching {topic} module",
    "Which files changed in {topic} since yesterday?",
    "Is {topic} branch ahead of main?",
    "Latest commit message on {topic} workspace",
    "Repo health check for {topic} project folder",
    "Count failing tests in {topic} pipeline",
    "When was {topic} last deployed from this repo?",
    "Diff summary for {topic} feature branch",
    "List merge conflicts in {topic} checkout",
  ],
  code_help: [
    "Fix the TypeError in {topic} training script",
    "Why does {topic} dataloader hang on macOS?",
    "Refactor {topic} function to avoid O(n^2) loop",
    "Write unit test for {topic} parser edge case",
    "Debug CUDA OOM in {topic} finetune job",
    "How to vectorize {topic} preprocessing in numpy?",
    "Implement {topic} metric in pytorch idiomatically",
    "Resolve import cycle in {topic} package",
    "Explain stack trace from {topic} eval crash",
    "Optimize SQL query for {topic} feature store",
    "Add retry logic to {topic} API client",
    "TypeScript types for {topic} config object",
  ],
  planning_admin: [
    "Schedule lab meeting about {topic} next Tuesday",
    "Draft agenda for {topic} grant check-in",
    "Who owns the {topic} milestone on the roadmap?",
    "Budget line items for {topic} cloud spend",
    "IRB timeline for {topic} human subjects study",
    "Assign reviewers for {topic} internal doc",
    "Calendar hold for {topic} data collection week",
    "Travel planning for {topic} conference submission",
    "Compliance checklist before {topic} trial starts",
    "Stakeholder email template for {topic} delay",
    "Project plan Gantt for {topic} phase 2",
    "Reschedule {topic} sync due to holiday",
  ],
  other: [
    "Mixed signals on {topic} — not sure which bucket",
    "Tough call: {topic} could be chat or research",
    "Edge case routing: {topic} with low stakes",
    "Ambiguous ask about {topic} — classify carefully",
    "Unclear intent on {topic} message",
    "Hybrid message mixing {topic} admin and science",
    "Non-standard {topic} request for the gate",
    "Gray area: {topic} might be critique or results",
    "Hard routing example involving {topic}",
    "Boundary stress test: {topic}",
    "Confusable phrasing around {topic}",
    "Evaluator probe: {topic} near class border",
  ],
};

const TOPICS = [
  "sleep restriction",
  "melatonin timing",
  "blue-light filters",
  "protein before bed",
  "HRV recovery",
  "dropout calibration",
  "LoRA rank selection",
  "KV cache quantization",
  "tool-use finetuning",
  "RAG chunk overlap",
  "council merge modes",
  "embedding drift",
  "probe agreement thresholds",
  "gate kNN seeds",
  "scribe duplicate detection",
  "validation loop peeking",
  "bench fixture DOIs",
  "OpenAlex rate limits",
  "semantic scholar backoff",
  "cross-session memory recall",
  "attention head collapse",
  "learning rate warm-up",
  "batch norm in small batches",
  "class imbalance weighting",
  "contrastive temperature",
  "speculative decoding",
  "MoE load balancing",
  "flash attention numerics",
  "dataset contamination checks",
  "human preference eval noise",
];

function buildGateFixtures() {
  const out = [];
  let id = 0;
  for (const taskType of TASK_TYPES) {
    const templates = HARD_TEMPLATES[taskType];
    let i = 0;
    while (out.filter((x) => x.taskType === taskType).length < 12) {
      const topic = TOPICS[(id + i) % TOPICS.length];
      const text = templates[i % templates.length].replaceAll("{topic}", topic);
      const norm = normalize(text);
      if (!forbidden.has(norm)) {
        forbidden.add(norm);
        const stakes = [
          "hypothesis_generation",
          "experiment_design",
          "literature_review",
          "critique",
          "results_interpretation",
        ].includes(taskType)
          ? "high"
          : taskType === "factual_lookup"
            ? "medium"
            : [
                  "chat",
                  "formatting",
                  "summarize_single",
                  "repo_status",
                ].includes(taskType)
              ? "low"
              : "medium";
        const needsEvidence = taskType === "factual_lookup";
        out.push({
          id: `eval-hard-${id}`,
          text,
          taskType,
          stakes,
          needsEvidence,
        });
        id += 1;
      }
      i += 1;
      if (i > 500) throw new Error(`Could not fill ${taskType}`);
    }
  }
  // Extra boundary-crossing items (156 base + 14 extras = 170)
  const extras = [
    {
      text: "Review papers on sleep debt but also give me the exact DOI of Walker 2017",
      taskType: "literature_review",
      stakes: "high",
      needsEvidence: false,
    },
    {
      text: "Is dropout 0.5 too high? Sounds like a methods critique but I only want the number from our run log",
      taskType: "results_interpretation",
      stakes: "high",
      needsEvidence: false,
    },
    {
      text: "Maybe we should A/B test blue filters — hypothesis or experiment design?",
      taskType: "experiment_design",
      stakes: "high",
      needsEvidence: false,
    },
    {
      text: "What papers argue against melatonin? Also hi, hope your week is fine",
      taskType: "literature_review",
      stakes: "high",
      needsEvidence: false,
    },
    {
      text: "Summarize the critique section of our draft on protein timing",
      taskType: "summarize_single",
      stakes: "low",
      needsEvidence: false,
    },
    {
      text: "Plan Tuesday standup and also sketch an RCT for caffeine washout",
      taskType: "planning_admin",
      stakes: "medium",
      needsEvidence: false,
    },
    {
      text: "Find citation count for Attention Is All You Need and compare transformer survey themes",
      taskType: "factual_lookup",
      stakes: "medium",
      needsEvidence: true,
    },
    {
      text: "The ablation shows +2 BLEU — celebrate or tear apart the claim?",
      taskType: "critique",
      stakes: "high",
      needsEvidence: false,
    },
    {
      text: "git status on bench branch — also interpret yesterday's loss spike",
      taskType: "repo_status",
      stakes: "low",
      needsEvidence: false,
    },
    {
      text: "Fix the pandas bug in results.py and explain whether p<0.05 supports H1",
      taskType: "code_help",
      stakes: "medium",
      needsEvidence: false,
    },
    {
      text: "Reformat references — unrelated: rival hypotheses for HRV drop?",
      taskType: "formatting",
      stakes: "low",
      needsEvidence: false,
    },
    {
      text: "General question: what's entropy? (not our project results)",
      taskType: "chat",
      stakes: "low",
      needsEvidence: false,
    },
    {
      text: "Uncategorizable slack noise about lunch and logits",
      taskType: "other",
      stakes: "low",
      needsEvidence: false,
    },
    {
      text: "Interpret Table 2 but first list papers on Table 2's method",
      taskType: "results_interpretation",
      stakes: "high",
      needsEvidence: false,
    },
  ];
  for (const e of extras) {
    const norm = normalize(e.text);
    if (forbidden.has(norm)) continue;
    forbidden.add(norm);
    out.push({ id: `eval-hard-${id}`, ...e });
    id += 1;
  }
  if (out.length < 150) throw new Error(`Only ${out.length} gate fixtures`);
  return out;
}

const SCRIBE_FIXTURES = [
  {
    file: "21.json",
    user: "User: We think melatonin 300mcg helps sleep onset.\nAssistant: Noted.\nUser: Update — pilot n=12 showed 8 min faster onset (p=0.04).",
    reply:
      "Pilot complete: melatonin 300mcg associated with ~8 min faster sleep onset (n=12, p=0.04).",
    expected: {
      records: [
        {
          type: "hypothesis",
          titleTerms: ["melatonin"],
          status: "proposed",
        },
        {
          type: "experiment",
          titleTerms: ["melatonin", "pilot"],
          status: "done",
        },
      ],
    },
    existing: [],
  },
  {
    file: "22.json",
    user: "Same as before: protein before bed hypothesis stands.",
    reply: "Affirming protein-before-bed hypothesis unchanged.",
    expected: { records: [] },
    existing: [
      {
        id: "h1",
        type: "hypothesis",
        title: "Protein before bed improves sleep quality",
        status: "proposed",
      },
    ],
  },
  {
    file: "23.json",
    user: "Lock decision: primary endpoint is sleep latency not WASO.",
    reply: "Decision recorded: primary endpoint = sleep latency.",
    expected: {
      records: [
        { type: "decision", titleTerms: ["sleep latency", "endpoint"] },
      ],
    },
    existing: [],
  },
  {
    file: "24.json",
    user: "Paper: Walker 2017 Why We Sleep — useful background.",
    reply: "Added Walker 2017 as background reading.",
    expected: {
      records: [{ type: "paper", titleTerms: ["Walker", "Sleep"] }],
    },
    existing: [],
  },
  {
    file: "25.json",
    user: "Open question: does blue light filter wear time matter?",
    reply: "Open question on filter wear duration.",
    expected: {
      records: [{ type: "question", titleTerms: ["blue", "filter"] }],
    },
    existing: [],
  },
  {
    file: "26.json",
    user: "Turn 1: plan crossover study.\nTurn 2: add washout week.\nTurn 3: exclude apnea AHI>15.",
    reply: "Crossover sleep study with 1-week washout; exclude AHI>15.",
    expected: {
      records: [
        { type: "experiment", titleTerms: ["crossover"], status: "planned" },
        { type: "note", titleTerms: ["AHI"] },
      ],
    },
    existing: [],
  },
  {
    file: "27.json",
    user: "Results: filters −12 min latency (already logged).",
    reply: "Re-stating −12 min latency improvement with filters.",
    expected: { records: [] },
    existing: [
      {
        id: "e1",
        type: "experiment",
        title: "Blue-light filters reduce sleep latency by 12 min",
        status: "done",
      },
    ],
  },
  {
    file: "28.json",
    user: "Chat only — great weather today!",
    reply: "Indeed, sunny and nice.",
    expected: { records: [] },
    existing: [],
  },
  {
    file: "29.json",
    user: "Hypothesis H2: caffeine after 2pm hurts deep sleep.",
    reply: "Proposed H2 linking afternoon caffeine to deep sleep loss.",
    expected: {
      records: [
        {
          type: "hypothesis",
          titleTerms: ["caffeine", "deep"],
          status: "proposed",
        },
      ],
    },
    existing: [
      {
        id: "h0",
        type: "hypothesis",
        title: "Caffeine after 2pm reduces deep sleep",
        status: "proposed",
      },
    ],
  },
  {
    file: "30.json",
    user: "We decided n=40 for 0.8 power (again).",
    reply: "Sample size n=40 chosen for 80% power.",
    expected: { records: [] },
    existing: [
      {
        id: "d1",
        type: "decision",
        title: "n=40 for power 0.8",
        status: "active",
      },
    ],
  },
  {
    file: "31.json",
    user: "Multi-finding reply: HRV up 5ms, latency down 9min, no effect on WASO.",
    reply: "HRV +5ms, sleep latency −9 min; WASO unchanged in this arm.",
    expected: {
      records: [
        { type: "note", titleTerms: ["HRV"] },
        { type: "note", titleTerms: ["latency"] },
        { type: "note", titleTerms: ["WASO"] },
      ],
    },
    existing: [],
  },
  {
    file: "32.json",
    user: "Assistant claimed quantum tunneling explains our logits (unsupported).",
    reply: "Quantum tunneling explains the logit spike we saw (no data cited).",
    expected: { records: [] },
    existing: [],
  },
  {
    file: "33.json",
    user: "Mark experiment 'filter crossover' as completed.",
    reply: "Experiment filter crossover marked complete.",
    expected: {
      records: [
        {
          type: "experiment",
          titleTerms: ["filter", "crossover"],
          status: "done",
        },
      ],
    },
    existing: [
      {
        id: "x1",
        type: "experiment",
        title: "Filter crossover sleep study",
        status: "planned",
      },
    ],
  },
  {
    file: "34.json",
    user: "Note exclusion: shift workers only if <6h sleep baseline.",
    reply: "Eligibility note: shift workers need <6h baseline sleep.",
    expected: { records: [{ type: "note", titleTerms: ["shift", "6h"] }] },
    existing: [],
  },
  {
    file: "35.json",
    user: "Long thread recap — user asked about melatonin, then power, then IRB.\nFinal ask: store IRB submission date April 3.",
    reply: "IRB submitted April 3 for melatonin pilot.",
    expected: {
      records: [{ type: "note", titleTerms: ["IRB", "April"] }],
    },
    existing: [],
  },
  {
    file: "36.json",
    user: "Finding: melatonin group REM +4% (pre-registered secondary).",
    reply: "Secondary outcome: REM +4% in melatonin arm.",
    expected: {
      records: [{ type: "note", titleTerms: ["REM", "melatonin"] }],
    },
    existing: [],
  },
  {
    file: "37.json",
    user: "Duplicate paper cite: Vaswani et al. 2017 transformers.",
    reply: "Citing Vaswani 2017 Attention Is All You Need.",
    expected: { records: [] },
    existing: [
      {
        id: "p1",
        type: "paper",
        title: "Attention Is All You Need",
        year: 2017,
      },
    ],
  },
  {
    file: "38.json",
    user: "User: maybe n=30?\nUser: actually n=40.\nUser: lock it.",
    reply: "Final decision n=40 locked.",
    expected: {
      records: [{ type: "decision", titleTerms: ["n=40"] }],
    },
    existing: [],
  },
  {
    file: "39.json",
    user: "Reply mentions p<0.001 for HRV but user never provided stats.",
    reply: "Highly significant HRV gain p<0.001 (fabricated precision).",
    expected: { records: [] },
    existing: [],
  },
  {
    file: "40.json",
    user: "Bundle: new hypothesis on magnesium; planned AB test; question on dropout.",
    reply:
      "Hypothesis: magnesium aids sleep onset. Planned AB test next month. Open question: optimal dropout for sleep model?",
    expected: {
      records: [
        { type: "hypothesis", titleTerms: ["magnesium"], status: "proposed" },
        { type: "experiment", titleTerms: ["AB"], status: "planned" },
        { type: "question", titleTerms: ["dropout"] },
      ],
    },
    existing: [],
  },
];

const gate = buildGateFixtures();
writeFileSync(
  path.join(root, "evals/gate/17.json"),
  JSON.stringify(gate, null, 2) + "\n",
);
console.log(`Wrote evals/gate/17.json (${gate.length} items)`);

const scribeDir = path.join(root, "evals/scribe");
for (const fx of SCRIBE_FIXTURES) {
  writeFileSync(
    path.join(scribeDir, fx.file),
    JSON.stringify(
      {
        user: fx.user,
        reply: fx.reply,
        expected: fx.expected,
        existing: fx.existing,
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(`Wrote ${SCRIBE_FIXTURES.length} scribe fixtures (21–40)`);
