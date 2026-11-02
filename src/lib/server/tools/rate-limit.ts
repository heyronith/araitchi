import "server-only";

export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.last = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillPerSec,
    );
  }

  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  async waitTake(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw new Error("Aborted");
      if (this.tryTake()) return;
      const missing = 1 - this.tokens;
      const waitMs = Math.max(
        5,
        Math.ceil((missing / this.refillPerSec) * 1000),
      );
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error("Aborted"));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, waitMs);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
  }
}

/** Requests per second per provider. */
export const DEFAULT_PROVIDER_LIMITS: Record<string, number> = {
  openalex: 10,
  semantic_scholar: 1,
  core: 5,
  arxiv: 3,
  dblp: 5,
  openreview: 3,
  crossref: 5,
  unpaywall: 5,
  web: 5,
  repo: 20,
  mcp: 5,
  default: 5,
};
