/** Derive lab from OpenRouter model id (`lab/model`). */
export function labFromModelId(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? "unknown" : id.slice(0, slash);
}

/** Convert OpenRouter per-token USD price to per-1M tokens. */
export function perTokenToPerMillion(
  perToken: number | string | null | undefined,
): number | null {
  if (perToken === null || perToken === undefined || perToken === "") {
    return null;
  }
  const n =
    typeof perToken === "number" ? perToken : Number.parseFloat(perToken);
  if (!Number.isFinite(n)) {
    return null;
  }
  return n * 1_000_000;
}

export type OpenRouterModelLike = {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
  };
  supported_parameters?: string[];
  [key: string]: unknown;
};

export function mapOpenRouterModel(model: OpenRouterModelLike) {
  const params = new Set(model.supported_parameters ?? []);
  const inputMods =
    model.architecture?.input_modalities ??
    (model.architecture?.modality
      ? model.architecture.modality.split("+")
      : ["text"]);

  return {
    id: model.id,
    name: model.name ?? model.id,
    lab: labFromModelId(model.id),
    contextLength: model.context_length ?? null,
    priceInPerMtok: perTokenToPerMillion(model.pricing?.prompt),
    priceOutPerMtok: perTokenToPerMillion(model.pricing?.completion),
    modalities: inputMods,
    supportsTools: params.has("tools") || params.has("tool_choice"),
    supportsStructuredOutputs:
      params.has("structured_outputs") || params.has("response_format"),
    supportsReasoning:
      params.has("reasoning") ||
      params.has("include_reasoning") ||
      /o1|o3|r1|thinking|reason/i.test(model.id),
    raw: model,
  };
}

const MAJOR_LABS = new Set([
  "openai",
  "anthropic",
  "google",
  "meta-llama",
  "mistralai",
  "deepseek",
]);

export type CachedModelRow = {
  id: string;
  name: string;
  lab: string;
  priceInPerMtok: number | null;
  supportsTools: boolean;
};

function isFreeTierModelId(id: string): boolean {
  return id.includes(":free");
}

function isSonnetLatestAlias(m: CachedModelRow): boolean {
  return (
    m.id === "~anthropic/claude-sonnet-latest" ||
    m.id === "anthropic/claude-sonnet-latest" ||
    /anthropic\/claude-sonnet-latest$/i.test(m.id)
  );
}

/** Pick default chat: paid tools-capable; prefer Claude Sonnet latest alias. */
export function pickDefaultModelId(models: CachedModelRow[]): string | null {
  const paid = models.filter((m) => !isFreeTierModelId(m.id));

  const sonnet = paid.find((m) => isSonnetLatestAlias(m) && m.supportsTools);
  if (sonnet) {
    return sonnet.id;
  }

  const candidates = paid
    .filter((m) => m.supportsTools && MAJOR_LABS.has(m.lab))
    .filter((m) => m.priceInPerMtok !== null)
    .sort(
      (a, b) => (a.priceInPerMtok ?? Infinity) - (b.priceInPerMtok ?? Infinity),
    );

  if (candidates[0]) {
    return candidates[0].id;
  }

  const anyTools = paid
    .filter((m) => m.supportsTools && m.priceInPerMtok !== null)
    .sort(
      (a, b) => (a.priceInPerMtok ?? Infinity) - (b.priceInPerMtok ?? Infinity),
    );

  const fallback = paid.find((m) => m.supportsTools) ?? paid[0];
  return anyTools[0]?.id ?? fallback?.id ?? null;
}
