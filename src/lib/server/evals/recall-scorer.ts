/**
 * Recall eval scoring helpers (shared by eval runner + Vitest).
 */
export type RecallMatchMode = "exact" | "semantic";

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

/** Build the long-horizon fixture (60 sessions, 100+ facts, 100 questions). */
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
  ];

  for (let i = 0; i < 100; i++) {
    const session = (i % 60) + 1;
    const key = changingKeys[i % changingKeys.length]!;
    const revision = Math.floor(i / changingKeys.length) + 1;
    facts.push({
      key: `${key}-r${revision}`,
      session,
      type: i % 7 === 0 ? "hypothesis" : i % 11 === 0 ? "decision" : "note",
      title: `${key} revision ${revision}`,
      body: `Fact ${key} value is ${1000 + i + revision * 7} at session ${session}.`,
      distractor: false,
    });
  }

  for (let k = 0; k < changingKeys.length; k++) {
    const key = changingKeys[k]!;
    for (let rev = 1; rev <= 4; rev++) {
      const session = Math.min(60, 10 + rev * 12 + k);
      facts.push({
        key,
        session,
        type: "note",
        title: `${key} (v${rev})`,
        body: `Latest ${key} is VALUE-${rev}-${k}-${session}.`,
      });
    }
  }

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

  const latestByKey = new Map<string, string>();
  const sortedFacts = [...facts]
    .filter((f) => !f.distractor)
    .sort((a, b) => a.session - b.session);
  for (const f of sortedFacts) {
    if (!f.key.startsWith("distractor")) {
      latestByKey.set(f.key.split("-r")[0] ?? f.key, f.body);
    }
  }
  for (const key of changingKeys) {
    const revFacts = facts
      .filter((f) => f.key === key)
      .sort((a, b) => b.session - a.session);
    if (revFacts[0]) latestByKey.set(key, revFacts[0].body);
  }

  const maxSessionByKey = new Map<string, number>();
  for (const f of facts) {
    if (f.distractor) continue;
    maxSessionByKey.set(
      f.key,
      Math.max(maxSessionByKey.get(f.key) ?? 0, f.session),
    );
  }

  const questions: RecallQuestion[] = [];
  let qi = 0;
  for (const key of changingKeys) {
    const expected = latestByKey.get(key) ?? "";
    questions.push({
      id: `q-${++qi}`,
      query: `What is the latest ${key.replace(/_/g, " ")}?`,
      expected,
      match: "semantic",
    });
  }

  for (let i = 0; i < 100 - changingKeys.length; i++) {
    const candidates = sortedFacts.filter(
      (f) => maxSessionByKey.get(f.key) === f.session,
    );
    const f = candidates[i % candidates.length]!;
    questions.push({
      id: `q-${++qi}`,
      query: `Recall: ${f.title}`,
      expected: f.body,
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
