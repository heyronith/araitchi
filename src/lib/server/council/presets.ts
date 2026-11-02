import { labFromModelId } from "@/lib/server/models-utils";

/**
 * Catalog row used for council preset resolution.
 * "Strongest" heuristic (documented):
 *   score = (reasoning ? 120 : 0)
 *         + min(contextLength/1000, 256)
 *         + 15 * log10(priceInPerMtok + 1)   // higher price ≈ stronger closed models
 *         + (majorLab ? 40 : 0)
 * Prefer chat/general models (exclude obvious embedding/audio/image-only ids).
 */
export type CatalogModel = {
  id: string;
  name: string;
  lab: string;
  contextLength: number | null;
  priceInPerMtok: number | null;
  priceOutPerMtok: number | null;
  supportsReasoning: boolean;
  modalities?: string[];
};

const MAJOR_LABS = [
  "openai",
  "anthropic",
  "google",
  "meta-llama",
  "mistralai",
  "deepseek",
  "x-ai",
  "qwen",
] as const;

const OPEN_WEIGHT_LABS = new Set([
  "meta-llama",
  "mistralai",
  "deepseek",
  "qwen",
  "google", // gemma
  "microsoft",
  "nvidia",
  "huggingface",
]);

function isGeneralChatModel(m: CatalogModel): boolean {
  const id = m.id.toLowerCase();
  if (/embed|whisper|tts|image|vision-only|moderation|rerank|codec/.test(id)) {
    return false;
  }
  if (m.modalities && !m.modalities.includes("text")) return false;
  return true;
}

export function strengthScore(m: CatalogModel): number {
  const ctx = Math.min((m.contextLength ?? 0) / 1000, 256);
  const price = m.priceInPerMtok ?? 0;
  const priceScore = 15 * Math.log10(price + 1);
  const reasoning = m.supportsReasoning ? 120 : 0;
  const major = MAJOR_LABS.includes(m.lab as (typeof MAJOR_LABS)[number])
    ? 40
    : 0;
  return reasoning + ctx + priceScore + major;
}

function bestPerLab(
  models: CatalogModel[],
  labs: readonly string[],
  pick: (candidates: CatalogModel[]) => CatalogModel | null,
): CatalogModel[] {
  const byLab = new Map<string, CatalogModel[]>();
  for (const m of models) {
    if (!byLab.has(m.lab)) byLab.set(m.lab, []);
    byLab.get(m.lab)!.push(m);
  }
  const out: CatalogModel[] = [];
  for (const lab of labs) {
    const candidates = byLab.get(lab) ?? [];
    const picked = pick(candidates);
    if (picked) out.push(picked);
  }
  return out;
}

/** Balanced: strongest general model from each of 3 different major labs. */
export function resolveBalancedPreset(catalog: CatalogModel[]): {
  members: string[];
  synthesizer: string;
} {
  const pool = catalog.filter(isGeneralChatModel);
  const scored = [...pool].sort((a, b) => strengthScore(b) - strengthScore(a));

  // Prefer major labs ordered by their best model's strength.
  const labBest = new Map<string, CatalogModel>();
  for (const m of scored) {
    if (!labBest.has(m.lab)) labBest.set(m.lab, m);
  }
  const rankedLabs = [...labBest.entries()]
    .filter(([lab]) => MAJOR_LABS.includes(lab as (typeof MAJOR_LABS)[number]))
    .sort((a, b) => strengthScore(b[1]) - strengthScore(a[1]))
    .slice(0, 3)
    .map(([, m]) => m);

  // Fallback: any top-3 distinct labs
  let members = rankedLabs;
  if (members.length < 3) {
    members = [];
    const seen = new Set<string>();
    for (const m of scored) {
      if (seen.has(m.lab)) continue;
      seen.add(m.lab);
      members.push(m);
      if (members.length >= 3) break;
    }
  }

  const synthesizer = members[0]?.id ?? scored[0]?.id ?? catalog[0]?.id ?? "";

  return {
    members: members.map((m) => m.id),
    synthesizer,
  };
}

/**
 * Budget: 3 strong open-weight models from 3 different labs —
 * cheapest that support ≥ 64k context (among open-weight labs).
 */
export function resolveBudgetPreset(catalog: CatalogModel[]): {
  members: string[];
  synthesizer: string;
} {
  const pool = catalog
    .filter(isGeneralChatModel)
    .filter((m) => (m.contextLength ?? 0) >= 64_000)
    .filter((m) => OPEN_WEIGHT_LABS.has(m.lab) || /free|:free$/i.test(m.id));

  const byLab = new Map<string, CatalogModel[]>();
  for (const m of pool) {
    if (!byLab.has(m.lab)) byLab.set(m.lab, []);
    byLab.get(m.lab)!.push(m);
  }

  const cheapestPerLab: CatalogModel[] = [];
  for (const [, list] of byLab) {
    const sorted = [...list].sort(
      (a, b) => (a.priceInPerMtok ?? 1e9) - (b.priceInPerMtok ?? 1e9),
    );
    if (sorted[0]) cheapestPerLab.push(sorted[0]);
  }

  // Prefer stronger among cheap open-weight, still one per lab.
  cheapestPerLab.sort((a, b) => strengthScore(b) - strengthScore(a));
  const members = cheapestPerLab.slice(0, 3);

  // Fallback if open-weight pool thin: cheapest 3 distinct labs overall ≥64k
  if (members.length < 3) {
    const broad = catalog
      .filter(isGeneralChatModel)
      .filter((m) => (m.contextLength ?? 0) >= 64_000)
      .sort((a, b) => (a.priceInPerMtok ?? 1e9) - (b.priceInPerMtok ?? 1e9));
    const seen = new Set(members.map((m) => m.lab));
    for (const m of broad) {
      if (seen.has(m.lab)) continue;
      seen.add(m.lab);
      members.push(m);
      if (members.length >= 3) break;
    }
  }

  const synthesizer = members[0]?.id ?? "";
  return { members: members.map((m) => m.id), synthesizer };
}

export function validateCouncilMembers(members: string[]): {
  ok: boolean;
  error?: string;
  labWarning?: string;
} {
  if (members.length < 3 || members.length > 10) {
    return { ok: false, error: "Council must have 3–10 members" };
  }
  const uniq = new Set(members);
  if (uniq.size !== members.length) {
    return { ok: false, error: "Council members must be unique" };
  }
  const labs = new Set(members.map(labFromModelId));
  if (labs.size < 3) {
    return {
      ok: true,
      labWarning: `Only ${labs.size} distinct lab(s); prefer ≥3 for diversity`,
    };
  }
  return { ok: true };
}

export function pickSubstituteModel(
  catalog: CatalogModel[],
  councilMemberIds: string[],
  failedModelId: string,
): CatalogModel | null {
  const usedLabs = new Set(
    councilMemberIds.map(labFromModelId).filter(Boolean),
  );
  const failedLab = labFromModelId(failedModelId);
  usedLabs.add(failedLab);

  const candidates = catalog
    .filter(isGeneralChatModel)
    .filter((m) => !councilMemberIds.includes(m.id))
    .filter((m) => !usedLabs.has(m.lab))
    .sort((a, b) => strengthScore(b) - strengthScore(a));

  return candidates[0] ?? null;
}

// silence unused helper in some trees
void bestPerLab;
