import { afterEach, describe, expect, it, vi } from "vitest";

import * as secrets from "@/lib/server/secrets";
import { requireOpenRouterApiKey } from "@/lib/server/openrouter";

describe("requireOpenRouterApiKey precedence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("prefers OPENROUTER_API_KEY over a stored secret", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-v1-from-env-live-check");
    vi.spyOn(secrets, "getSecret").mockResolvedValue("sk-or-v1-fake-e2e-key");
    await expect(requireOpenRouterApiKey()).resolves.toBe(
      "sk-or-v1-from-env-live-check",
    );
    expect(secrets.getSecret).not.toHaveBeenCalled();
  });
});
