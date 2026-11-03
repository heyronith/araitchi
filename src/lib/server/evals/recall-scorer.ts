/**
 * Recall eval scoring helpers (shared by eval runner + Vitest).
 */
export type RecallMatchMode = "exact" | "semantic";

export type RecallQuestionKind =
  | "static"
  | "changed_later"
  | "oldest"
  | "distractor_resistance";

export function normalizeRecallText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\p{L}\p{N}\s.%+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreRecallAnswer(
  retrieved: string,
  expected: string,
  mode: RecallMatchMode = "semantic",
): boolean {
  const r = normalizeRecallText(retrieved);
  const e = normalizeRecallText(expected);
  if (!e) return false;
  if (mode === "exact") return r === e;
  if (r.includes(e)) return true;
  const eTokens = e.split(" ").filter((t) => t.length > 2);
  if (!eTokens.length) return r.includes(e);
  const hits = eTokens.filter((t) => r.includes(t)).length;
  return hits / eTokens.length >= 0.85;
}

export type RecallQuestion = {
  id: string;
  query: string;
  expected: string;
  match?: RecallMatchMode;
  kind: RecallQuestionKind;
  /** For changed_later: older values that must NOT win. */
  superseded?: string[];
};

export type RecallFixture = {
  version: 1;
  sessions: { id: string; day: number; title: string }[];
  facts: {
    key: string;
    session: number;
    type: "note" | "hypothesis" | "decision" | "question";
    title: string;
    body: string;
    distractor?: boolean;
  }[];
  questions: RecallQuestion[];
};

/**
 * Build long-horizon fixture:
 * - 60 sessions
 * - static facts (never updated)
 * - changing keys updated across sessions (latest must win)
 * - oldest-session static facts
 * - distractors + resistance questions
 */
export function buildLongProjectFixture(): RecallFixture {
  const sessions = Array.from({ length: 60 }, (_, i) => ({
    id: `s${i + 1}`,
    day: i * 2,
    title: `Session ${i + 1}`,
  }));

  const facts: RecallFixture["facts"] = [];
  const changingKeys = [
    "primary_metric",
    "sample_size",
    "lab_temperature",
    "model_version",
    "deadline",
  ] as const;

  // Static facts spread across sessions (unique keys, never updated)
  for (let i = 0; i < 40; i++) {
    const session = (i % 60) + 1;
    facts.push({
      key: `static-${i}`,
      session,
      type: i % 5 === 0 ? "hypothesis" : "note",
      title: `Static fact ${i}`,
      body: `STATIC-TOKEN-${i} holds for protocol alpha-${i}.`,
      distractor: false,
    });
  }

  // Oldest-session anchors (sessions 1–5)
  for (let i = 0; i < 15; i++) {
    const session = (i % 5) + 1;
    facts.push({
      key: `oldest-${i}`,
      session,
      type: "note",
      title: `Early notebook ${i}`,
      body: `OLDEST-TOKEN-${i} recorded in week zero session ${session}.`,
      distractor: false,
    });
  }

  // Changing facts: same key rewritten across later sessions
  const changeHistory: Record<string, string[]> = {};
  for (const key of changingKeys) {
    changeHistory[key] = [];
    for (let rev = 1; rev <= 6; rev++) {
      const session = Math.min(60, 8 + rev * 8 + changingKeys.indexOf(key));
      const body = `LATEST-${key}-R${rev} value=${100 + rev * 11}-${key}.`;
      changeHistory[key]!.push(body);
      facts.push({
        key,
        session,
        type: "note",
        title: `${key.replace(/_/g, " ")} (current)`,
        body,
        distractor: false,
      });
    }
  }

  // Distractors
  for (let d = 0; d < 30; d++) {
    facts.push({
      key: `distractor-${d}`,
      session: (d % 60) + 1,
      type: "note",
      title: `Unrelated noise ${d}`,
      body: `Random distractor about unrelated topic zebra-${d} not relevant.`,
      distractor: true,
    });
  }

  const questions: RecallQuestion[] = [];
  let qi = 0;

  // changed_later: ask for latest; superseded must not appear as the answer
  for (const key of changingKeys) {
    const hist = changeHistory[key]!;
    const expected = hist[hist.length - 1]!;
    const superseded = hist.slice(0, -1);
    questions.push({
      id: `q-${++qi}`,
      kind: "changed_later",
      query: `What is the latest ${key.replace(/_/g, " ")}?`,
      expected,
      superseded,
      match: "semantic",
    });
  }
  // Extra changed_later variants
  for (const key of changingKeys) {
    const hist = changeHistory[key]!;
    const expected = hist[hist.length - 1]!;
    questions.push({
      id: `q-${++qi}`,
      kind: "changed_later",
      query: `Report the current ${key.replace(/_/g, " ")} value used in the project.`,
      expected,
      superseded: hist.slice(0, -1),
      match: "semantic",
    });
  }

  // static
  for (let i = 0; i < 40; i++) {
    questions.push({
      id: `q-${++qi}`,
      kind: "static",
      query: `What does static fact ${i} say?`,
      expected: `STATIC-TOKEN-${i}`,
      match: "semantic",
    });
  }

  // oldest
  for (let i = 0; i < 15; i++) {
    questions.push({
      id: `q-${++qi}`,
      kind: "oldest",
      query: `Recall early notebook ${i} from the first week.`,
      expected: `OLDEST-TOKEN-${i}`,
      match: "semantic",
    });
  }

  // distractor resistance: ask by exact title amid distractor-filled notebook
  for (let i = 0; i < 35; i++) {
    const si = i % 40;
    questions.push({
      id: `q-${++qi}`,
      kind: "distractor_resistance",
      query: `Look up notebook entry titled "Static fact ${si}" and quote its body token.`,
      expected: `STATIC-TOKEN-${si}`,
      match: "semantic",
    });
  }

  return {
    version: 1,
    sessions,
    facts,
    questions: questions.slice(0, 100),
  };
}

export function summarizeRecallByKind(
  results: { kind: RecallQuestionKind; ok: boolean }[],
): Record<RecallQuestionKind, { n: number; correct: number; pct: number }> {
  const kinds: RecallQuestionKind[] = [
    "static",
    "changed_later",
    "oldest",
    "distractor_resistance",
  ];
  const out = {} as Record<
    RecallQuestionKind,
    { n: number; correct: number; pct: number }
  >;
  for (const k of kinds) {
    const rows = results.filter((r) => r.kind === k);
    const correct = rows.filter((r) => r.ok).length;
    const n = rows.length;
    out[k] = {
      n,
      correct,
      pct: n ? Math.round((correct / n) * 1000) / 10 : 0,
    };
  }
  return out;
}
