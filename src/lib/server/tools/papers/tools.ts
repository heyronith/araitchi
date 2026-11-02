import "server-only";

import { z } from "zod";

import type { RegisteredTool, ToolResult, ToolSource } from "../types";
import { getPaper, paperLinks, searchPapers, SEARCH_PROVIDERS } from "./search";
import type { Paper, PaperProvider } from "./types";

export type PaperToolContext = {
  projectPath?: string;
  contactEmail?: string;
  /** Providers to query for `search_papers`; defaults to all of them. */
  enabledProviders?: PaperProvider[];
};

/** Cache TTL for paper tools: 7 days. */
export const PAPERS_TTL_SEC = 604_800;
const MAX_ABSTRACT_CHARS = 600;
const MAX_AUTHORS = 6;

function paperToSource(p: Paper): ToolSource {
  const source: ToolSource = { title: p.title };
  const url = p.url ?? p.pdfUrl;
  if (url) source.url = url;
  if (p.doi) source.doi = p.doi;
  if (p.arxivId) source.arxivId = p.arxivId;
  return source;
}

export function formatPaperForModel(p: Paper, index?: number): string {
  const authors =
    p.authors.length > MAX_AUTHORS
      ? `${p.authors.slice(0, MAX_AUTHORS).join(", ")} et al.`
      : p.authors.join(", ");
  const lines = [
    `${index !== undefined ? `${index + 1}. ` : ""}${p.title}`,
    [authors, p.year, p.venue].filter(Boolean).join(" · "),
    [
      p.doi ? `DOI: ${p.doi}` : null,
      p.arxivId ? `arXiv: ${p.arxivId}` : null,
      p.citationCount !== null ? `Citations: ${p.citationCount}` : null,
      `Found by: ${p.foundBy.join(", ")}`,
    ]
      .filter(Boolean)
      .join(" | "),
  ];
  if (p.url) lines.push(`URL: ${p.url}`);
  if (p.pdfUrl) lines.push(`PDF: ${p.pdfUrl}`);
  if (p.abstract) {
    lines.push(
      p.abstract.length > MAX_ABSTRACT_CHARS
        ? `Abstract: ${p.abstract.slice(0, MAX_ABSTRACT_CHARS)}…`
        : `Abstract: ${p.abstract}`,
    );
  }
  return lines.filter((l) => l.length > 0).join("\n");
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Paper tool failed";
}

/** Maps provider error strings to rate_limit | no_key | error for model text. */
export function providerFailureKind(
  error?: string,
): "rate_limit" | "no_key" | "error" {
  if (!error) return "error";
  const e = error.toLowerCase();
  if (e.startsWith("rate_limited") || e.includes("rate limit"))
    return "rate_limit";
  if (e.includes("_api_key") || e.includes("not configured")) return "no_key";
  return "error";
}

function formatProviderFailure(provider: string, error?: string): string {
  const kind = providerFailureKind(error);
  if (kind === "error" && error) return `${provider} (${kind}: ${error})`;
  return `${provider} (${kind})`;
}

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  yearFrom: z.number().int().min(1000).max(3000).optional(),
  yearTo: z.number().int().min(1000).max(3000).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const idShape = {
  doi: z.string().min(3).max(300).optional(),
  arxivId: z.string().min(4).max(100).optional(),
};
const needsId = (v: { doi?: string; arxivId?: string }) =>
  Boolean(v.doi || v.arxivId);
const idMessage = { message: "Provide doi or arxivId" };

const getSchema = z.object(idShape).refine(needsId, idMessage);

const linksSchema = z
  .object({
    ...idShape,
    direction: z.enum(["citations", "references"]),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .refine(needsId, idMessage);

/** Builds `search_papers`, `get_paper` and `paper_links` for one chat request. */
export function createPaperTools(ctx: PaperToolContext = {}): RegisteredTool[] {
  const contactEmail = ctx.contactEmail ?? "";

  const search_papers: RegisteredTool = {
    name: "search_papers",
    description:
      "Search scholarly papers across OpenAlex, CORE, Semantic Scholar, arXiv, DBLP, OpenReview and Crossref. Results are merged, de-duplicated by DOI/arXiv id/title and ranked. Optional year range; limit up to 50.",
    inputSchema: searchSchema,
    kind: "read",
    provider: "papers",
    ttlSec: PAPERS_TTL_SEC,
    handler: async (
      args: z.infer<typeof searchSchema>,
      toolCtx,
    ): Promise<ToolResult> => {
      try {
        const { papers, providers } = await searchPapers({
          query: args.query,
          yearFrom: args.yearFrom,
          yearTo: args.yearTo,
          limit: args.limit ?? 10,
          contactEmail,
          enabledProviders: ctx.enabledProviders,
          signal: toolCtx?.signal,
        });
        const providerSummary = providers.map((p) => ({
          provider: p.provider,
          ok: p.ok,
          error: p.error,
          count: p.papers.length,
          latencyMs: p.latencyMs,
        }));
        if (providers.length > 0 && providers.every((p) => !p.ok)) {
          return {
            ok: false,
            error: `All paper providers failed: ${providers
              .map((p) => `${p.provider}: ${p.error ?? "error"}`)
              .join("; ")}`,
          };
        }
        const okCount = providers.filter((p) => p.ok).length;
        const totalSources = providers.length;
        const failed = providerSummary
          .filter((p) => !p.ok)
          .map((p) => formatProviderFailure(p.provider, p.error));
        const modelText = [
          `Searched ${okCount} of ${totalSources} sources for "${args.query}"`,
          failed.length ? `Failures: ${failed.join(", ")}` : null,
          ...papers.map((p, i) => formatPaperForModel(p, i)),
        ]
          .filter((l): l is string => l !== null)
          .join("\n\n");
        return {
          ok: true,
          data: { query: args.query, papers, providers: providerSummary },
          sources: papers.map(paperToSource),
          modelText,
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },
  };

  const get_paper: RegisteredTool = {
    name: "get_paper",
    description:
      "Get details for one paper by DOI or arXiv id: metadata, abstract, citation count, and a legal open-access PDF link when available.",
    inputSchema: getSchema,
    kind: "read",
    provider: "papers",
    ttlSec: PAPERS_TTL_SEC,
    handler: async (
      args: z.infer<typeof getSchema>,
      toolCtx,
    ): Promise<ToolResult> => {
      try {
        const paper = await getPaper({
          doi: args.doi,
          arxivId: args.arxivId,
          contactEmail,
          signal: toolCtx?.signal,
        });
        if (!paper) return { ok: false, error: "Paper not found" };
        return {
          ok: true,
          data: { paper },
          sources: [paperToSource(paper)],
          modelText: formatPaperForModel(paper),
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },
  };

  const paper_links: RegisteredTool = {
    name: "paper_links",
    description:
      "Follow citations for novelty checks: list papers that cite a paper (direction=citations) or papers it references (direction=references). Uses Semantic Scholar with OpenAlex fallback.",
    inputSchema: linksSchema,
    kind: "read",
    provider: "papers",
    ttlSec: PAPERS_TTL_SEC,
    handler: async (
      args: z.infer<typeof linksSchema>,
      toolCtx,
    ): Promise<ToolResult> => {
      try {
        const papers = await paperLinks({
          doi: args.doi,
          arxivId: args.arxivId,
          direction: args.direction,
          limit: args.limit ?? 20,
          signal: toolCtx?.signal,
        });
        const header = `${papers.length} ${args.direction} of ${args.doi ?? args.arxivId}`;
        return {
          ok: true,
          data: { direction: args.direction, papers },
          sources: papers.map(paperToSource),
          modelText: [
            header,
            ...papers.map((p, i) => formatPaperForModel(p, i)),
          ].join("\n\n"),
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },
  };

  return [search_papers, get_paper, paper_links];
}

export type PapersToolContext = PaperToolContext & {
  /** Per-provider enable flags from Settings → Tools (missing = enabled). */
  providers?: Partial<Record<string, boolean>>;
};

/**
 * Entry point used by `tools/register.ts`. Maps the per-provider enable flags
 * to `enabledProviders`; returns no tools when every search provider is off.
 */
export function registerPapersTools(
  ctx: PapersToolContext = {},
): RegisteredTool[] {
  const enabledProviders = SEARCH_PROVIDERS.filter(
    (p) => ctx.providers?.[p] !== false,
  );
  if (enabledProviders.length === 0) return [];
  return createPaperTools({
    projectPath: ctx.projectPath,
    contactEmail: ctx.contactEmail,
    enabledProviders,
  });
}
