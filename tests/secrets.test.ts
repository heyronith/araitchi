import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getAppDb } from "@/lib/server/db/client";
import { secrets } from "@/lib/server/db/schema";
import { getAppDataDir } from "@/lib/server/paths";
import {
  deleteSecret,
  getSecret,
  getSecretCiphertextForTests,
  hasSecret,
  setSecret,
} from "@/lib/server/secrets";

describe("secrets", () => {
  it("round-trips set/get", () => {
    setSecret("openrouter_api_key", "sk-test-roundtrip-value");
    expect(getSecret("openrouter_api_key")).toBe("sk-test-roundtrip-value");
    expect(hasSecret("openrouter_api_key")).toBe(true);
  });

  it("does not store plaintext at rest", () => {
    const plaintext = "sk-super-secret-plaintext-value";
    setSecret("openrouter_api_key", plaintext);

    const ciphertext = getSecretCiphertextForTests("openrouter_api_key");
    expect(ciphertext).toBeTruthy();
    expect(ciphertext).not.toContain(plaintext);

    const dbPath = path.join(getAppDataDir(), "app.db");
    const raw = readFileSync(dbPath);
    expect(raw.includes(plaintext)).toBe(false);
  });

  it("throws when ciphertext is tampered", () => {
    setSecret("github_token", "ghp_valid_token_value");

    getAppDb()
      .update(secrets)
      .set({ ciphertext: Buffer.from("tampered-data").toString("base64") })
      .where(eq(secrets.name, "github_token"))
      .run();

    expect(() => getSecret("github_token")).toThrow();
  });

  it("rejects non-whitelisted names", () => {
    expect(() => setSecret("not_allowed", "value")).toThrow(/not allowed/i);
  });

  it("deletes secrets", () => {
    setSecret("core_api_key", "core-secret");
    expect(hasSecret("core_api_key")).toBe(true);
    expect(deleteSecret("core_api_key")).toBe(true);
    expect(hasSecret("core_api_key")).toBe(false);
    expect(getSecret("core_api_key")).toBeNull();
  });
});
