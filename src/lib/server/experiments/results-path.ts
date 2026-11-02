import { denyReasonForRelativePath } from "@/lib/server/tools/repo/paths";

/**
 * Lexical validation for experiment resultsPath (design-time + check-time).
 * Must be a relative POSIX path under experiments/<experimentId>/, ending in .json.
 */
export function defaultResultsPath(experimentId: string): string {
  return `experiments/${experimentId}/results.json`;
}

export function isSafeExperimentId(id: string): boolean {
  return /^E-\d+$/.test(id) || /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id);
}

/**
 * Normalize and validate a candidate results path for a given experiment id.
 * Does not touch the filesystem.
 */
export function validateResultsPath(
  experimentId: string,
  candidate: string | null | undefined,
): { ok: true; path: string } | { ok: false; error: string } {
  if (!isSafeExperimentId(experimentId)) {
    return { ok: false, error: "Invalid experiment id" };
  }
  const trimmed = (candidate ?? "").trim();
  const raw = trimmed.length === 0 ? defaultResultsPath(experimentId) : trimmed;

  if (raw.includes("\0")) {
    return { ok: false, error: "Invalid results path" };
  }
  // Reject absolute POSIX and Windows paths (drive letter / UNC).
  if (
    raw.startsWith("/") ||
    raw.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(raw) ||
    raw.startsWith("\\\\")
  ) {
    return { ok: false, error: "resultsPath must be a relative path" };
  }

  // Normalize to POSIX separators for segment checks.
  const posix = raw.replace(/\\/g, "/");
  if (posix !== raw && /\\/.test(raw)) {
    // Backslashes are only allowed as separators we normalize; reject mixed escapes
  }
  const segments = posix.split("/").filter((s) => s.length > 0);
  if (segments.some((s) => s === "." || s === "..")) {
    return { ok: false, error: "resultsPath must not contain '.' or '..'" };
  }
  if (!posix.toLowerCase().endsWith(".json")) {
    return { ok: false, error: "resultsPath must end with .json" };
  }

  const prefix = `experiments/${experimentId}/`;
  if (!posix.startsWith(prefix) || posix === prefix.slice(0, -1)) {
    return {
      ok: false,
      error: `resultsPath must be under ${prefix}`,
    };
  }

  const deny = denyReasonForRelativePath(posix);
  if (deny) {
    return { ok: false, error: deny };
  }

  return { ok: true, path: posix };
}

/** Truncate for evidence/messages — never include file bodies. */
export function truncatePathForEvidence(p: string, max = 200): string {
  if (p.length <= max) return p;
  return `${p.slice(0, max - 1)}…`;
}

export function schemaIssuesForEvidence(
  issues: { path?: PropertyKey[]; message: string }[],
  max = 3,
): string {
  return issues
    .slice(0, max)
    .map((i) => {
      const loc =
        (i.path ?? [])
          .map((p) => String(p))
          .filter((p) => p !== "Symbol()")
          .join(".") || "(root)";
      // Message only — never attach received values / file snippets
      const msg = i.message
        .replace(/["'`].{20,}?["'`]/g, '"…"')
        .replace(/\s+/g, " ")
        .slice(0, 120);
      return `${loc}: ${msg}`;
    })
    .join("; ");
}
