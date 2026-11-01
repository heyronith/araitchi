import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  base64UrlEncode,
  createS256Challenge,
  generateCodeVerifier,
} from "@/lib/server/pkce";

describe("PKCE S256", () => {
  it("matches the RFC 7636 appendix B test vector", () => {
    // https://datatracker.ietf.org/doc/html/rfc7636#appendix-B
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createS256Challenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generates a verifier of sufficient length", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const again = createS256Challenge(verifier);
    const expected = base64UrlEncode(
      createHash("sha256").update(verifier, "ascii").digest(),
    );
    expect(again).toBe(expected);
  });
});
