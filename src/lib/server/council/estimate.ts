import type { CatalogModel } from "./presets";
import type { CouncilConfig } from "./types";

export type CostLine = {
  modelId: string;
  role: "member" | "synthesizer";
  inputTokensEst: number;
  outputTokensEst: number;
  /** Lower bound uses ~50% of max output tokens. */
  costLowUsd: number;
  costHighUsd: number;
};

export type CouncilEstimate = {
  lines: CostLine[];
  totalLowUsd: number;
  totalHighUsd: number;
  inputChars: number;
  inputTokensEst: number;
};

function priceOrZero(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Estimate cost range for a council turn.
 * inputTokens ≈ chars/4 of full context; high output = maxOutputTokensPerMember;
 * low output = 50% of max. Prices are USD per 1M tokens.
 */
export function estimateCouncilCost(input: {
  contextChars: number;
  config: CouncilConfig;
  catalog: CatalogModel[];
}): CouncilEstimate {
  const byId = new Map(input.catalog.map((m) => [m.id, m]));
  const inputTokensEst = Math.max(1, Math.ceil(input.contextChars / 4));
  const outHigh = input.config.maxOutputTokensPerMember;
  const outLow = Math.ceil(outHigh * 0.5);

  const lines: CostLine[] = [];

  const push = (modelId: string, role: CostLine["role"]) => {
    const m = byId.get(modelId);
    const pin = priceOrZero(m?.priceInPerMtok);
    const pout = priceOrZero(m?.priceOutPerMtok);
    const inCost = (inputTokensEst / 1_000_000) * pin;
    const costLowUsd = inCost + (outLow / 1_000_000) * pout;
    const costHighUsd = inCost + (outHigh / 1_000_000) * pout;
    lines.push({
      modelId,
      role,
      inputTokensEst,
      outputTokensEst: outHigh,
      costLowUsd,
      costHighUsd,
    });
  };

  for (const id of input.config.members) push(id, "member");
  if (input.config.synthesizer) push(input.config.synthesizer, "synthesizer");

  // Synthesizer also sees member answers — add rough extra input (~members * outHigh/2)
  const synth = lines.find((l) => l.role === "synthesizer");
  if (synth) {
    const extraChars =
      input.config.members.length * outHigh * 2; /* rough tokens→chars */
    const extraTok = Math.ceil(extraChars / 4);
    const m = byId.get(synth.modelId);
    const pin = priceOrZero(m?.priceInPerMtok);
    const extra = (extraTok / 1_000_000) * pin;
    synth.inputTokensEst += extraTok;
    synth.costLowUsd += extra;
    synth.costHighUsd += extra;
  }

  return {
    lines,
    totalLowUsd: lines.reduce((s, l) => s + l.costLowUsd, 0),
    totalHighUsd: lines.reduce((s, l) => s + l.costHighUsd, 0),
    inputChars: input.contextChars,
    inputTokensEst,
  };
}
