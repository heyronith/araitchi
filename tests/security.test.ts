import { describe, expect, it } from "vitest";

import { assertLocalOrigin } from "@/lib/server/security";

function requestWithOrigin(origin: string | null): Request {
  const headers = new Headers();
  if (origin !== null) {
    headers.set("origin", origin);
  }
  return new Request("http://127.0.0.1:3000/api/secrets", {
    method: "PUT",
    headers,
  });
}

describe("security origin guard", () => {
  it("allows localhost and 127.0.0.1 on the app port", () => {
    expect(
      assertLocalOrigin(requestWithOrigin("http://localhost:3000")),
    ).toBeNull();
    expect(
      assertLocalOrigin(requestWithOrigin("http://127.0.0.1:3000")),
    ).toBeNull();
  });

  it("rejects localhost on a different port", async () => {
    const response = assertLocalOrigin(
      requestWithOrigin("http://localhost:5173"),
    );
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
  });

  it("allows missing Origin", () => {
    expect(assertLocalOrigin(requestWithOrigin(null))).toBeNull();
  });

  it("rejects non-local origins", async () => {
    const response = assertLocalOrigin(
      requestWithOrigin("https://evil.example"),
    );
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
    const body = await response!.json();
    expect(body.error).toMatch(/forbidden/i);
  });
});
