import { describe, expect, it } from "vitest";

import {
  labFromModelId,
  mapOpenRouterModel,
  perTokenToPerMillion,
  pickDefaultModelId,
} from "@/lib/server/models-utils";

describe("models utils", () => {
  it("converts per-token USD to per-1M", () => {
    expect(perTokenToPerMillion(0.000001)).toBeCloseTo(1);
    expect(perTokenToPerMillion("0.00000015")).toBeCloseTo(0.15);
    expect(perTokenToPerMillion(null)).toBeNull();
  });

  it("derives lab from model id", () => {
    expect(labFromModelId("openai/gpt-4o")).toBe("openai");
    expect(labFromModelId("no-slash")).toBe("unknown");
  });

  it("maps openrouter model fields", () => {
    const mapped = mapOpenRouterModel({
      id: "openai/gpt-4o-mini",
      name: "Mini",
      context_length: 128000,
      pricing: { prompt: "0.00000015", completion: "0.0000006" },
      architecture: { input_modalities: ["text", "image"] },
      supported_parameters: ["tools", "reasoning"],
    });
    expect(mapped.lab).toBe("openai");
    expect(mapped.supportsTools).toBe(true);
    expect(mapped.supportsReasoning).toBe(true);
    expect(mapped.priceInPerMtok).toBeCloseTo(0.15);
  });

  it("picks a cheap tools-capable default from a major lab", () => {
    const id = pickDefaultModelId([
      {
        id: "acme/expensive",
        name: "Exp",
        lab: "acme",
        priceInPerMtok: 0.01,
        supportsTools: true,
      },
      {
        id: "openai/cheap",
        name: "Cheap",
        lab: "openai",
        priceInPerMtok: 0.1,
        supportsTools: true,
      },
      {
        id: "openai/cheaper",
        name: "Cheaper",
        lab: "openai",
        priceInPerMtok: 0.05,
        supportsTools: true,
      },
    ]);
    expect(id).toBe("openai/cheaper");
  });

  it("never picks :free models and prefers claude-sonnet-latest alias", () => {
    const id = pickDefaultModelId([
      {
        id: "meta-llama/llama-3:free",
        name: "Free",
        lab: "meta-llama",
        priceInPerMtok: 0,
        supportsTools: true,
      },
      {
        id: "~anthropic/claude-sonnet-latest",
        name: "Sonnet",
        lab: "anthropic",
        priceInPerMtok: 3,
        supportsTools: true,
      },
      {
        id: "openai/cheaper",
        name: "Cheaper",
        lab: "openai",
        priceInPerMtok: 0.05,
        supportsTools: true,
      },
    ]);
    expect(id).toBe("~anthropic/claude-sonnet-latest");
  });
});
