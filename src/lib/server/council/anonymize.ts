import type { CouncilAnalysis } from "./types";

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export type AnonymizedMember = {
  label: string; // "Member A"
  modelId: string;
  content: string;
};

/** Shuffle members and assign Member A/B/C… labels. */
export function anonymizeMembers(
  members: { modelId: string; content: string }[],
  random: () => number = Math.random,
): { anonymized: AnonymizedMember[]; labelToModelId: Record<string, string> } {
  const shuffled = [...members];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  const anonymized: AnonymizedMember[] = [];
  const labelToModelId: Record<string, string> = {};
  shuffled.forEach((m, i) => {
    const letter = LABELS[i] ?? String(i);
    const label = `Member ${letter}`;
    anonymized.push({ label, modelId: m.modelId, content: m.content });
    labelToModelId[label] = m.modelId;
  });
  return { anonymized, labelToModelId };
}

/** Map Member A/B labels in analysis back to model ids. */
export function deanonymizeAnalysis(
  analysis: CouncilAnalysis,
  labelToModelId: Record<string, string>,
): CouncilAnalysis & { labelToModelId: Record<string, string> } {
  const mapLabel = (label: string) => labelToModelId[label] ?? label;

  return {
    ...analysis,
    contradictions: analysis.contradictions.map((c) => ({
      ...c,
      positions: c.positions.map((p) => ({
        ...p,
        member: mapLabel(p.member),
      })),
    })),
    uniqueInsights: analysis.uniqueInsights.map((u) => ({
      ...u,
      member: mapLabel(u.member),
    })),
    labelToModelId,
  };
}

export function formatAnonymizedPrompt(anonymized: AnonymizedMember[]): string {
  return anonymized
    .map((m) => `### ${m.label}\n\n${m.content}`)
    .join("\n\n---\n\n");
}
