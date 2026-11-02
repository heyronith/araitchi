/**
 * Bench-run context (module-scoped) so paper search can enforce yearTo
 * cutoffs during rediscovery items without threading through every call site.
 */

export type BenchRunContext = {
  yearTo?: number;
  configId?: "A" | "B" | "C" | "D";
  budgetCapUsd?: number;
  dryRun?: boolean;
};

let current: BenchRunContext | null = null;

export function setBenchContext(ctx: BenchRunContext | null): void {
  current = ctx;
}

export function getBenchContext(): BenchRunContext | null {
  return current;
}

export function withBenchContext<T>(
  ctx: BenchRunContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const prev = current;
  current = ctx;
  try {
    const result = fn();
    if (result && typeof (result as Promise<T>).then === "function") {
      return (result as Promise<T>).finally(() => {
        current = prev;
      });
    }
    current = prev;
    return result;
  } catch (e) {
    current = prev;
    throw e;
  }
}
