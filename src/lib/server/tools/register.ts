import "server-only";

import type { ToolBroker } from "./broker";
import {
  connectMcpServer,
  createMcpTools,
  type McpClientLike,
} from "./mcp/client";
import { createDocumentTools } from "./documents/tools";
import { createMemoryTools } from "./memory/tools";
import { createProjectTools } from "./project/tools";
import { registerPapersTools } from "./papers/tools";
import type { PaperProvider } from "./papers/types";
import { createRepoTools, detectRepoPath } from "./repo/tools";
import {
  getContactEmail,
  getMcpServers,
  getProviderEnables,
  getToolToggles,
  type McpServerConfig,
} from "./tools-settings";
import type { ToolToggles } from "./types";

export function registerEnabledTools(
  broker: ToolBroker,
  opts: {
    projectPath: string;
    toggles?: ToolToggles;
  },
): ToolToggles {
  const toggles = opts.toggles ?? getToolToggles(opts.projectPath);
  const contactEmail = getContactEmail() || null;
  const enables = getProviderEnables();
  const enabledProviders = (Object.entries(enables) as [string, boolean][])
    .filter(([name, on]) => on && name !== "unpaywall")
    .map(([name]) => name as PaperProvider);

  if (toggles.papers) {
    const providers = Object.fromEntries(
      enabledProviders.map((p) => [p, true]),
    ) as Partial<Record<string, boolean>>;
    // Disable any search provider not in the enabled list
    for (const name of [
      "openalex",
      "semantic_scholar",
      "arxiv",
      "dblp",
      "crossref",
      "core",
      "openreview",
    ]) {
      if (!(name in providers)) providers[name] = false;
    }
    broker.registerAll(
      registerPapersTools({
        contactEmail: contactEmail ?? undefined,
        providers,
      }),
    );
  }
  if (toggles.documents) {
    broker.registerAll(createDocumentTools());
  }
  if (toggles.memory) {
    broker.registerAll(createMemoryTools());
  }
  broker.registerAll(createProjectTools());
  if (toggles.repo) {
    const repoPath = detectRepoPath(opts.projectPath);
    broker.registerAll(
      createRepoTools({ projectPath: opts.projectPath, repoPath }),
    );
  }
  return toggles;
}

export type BuildBrokerToolsInput = {
  broker: ToolBroker;
  projectPath: string;
  toggles: ToolToggles;
  contactEmail?: string;
  /** Repo root; auto-detected for the project when omitted. */
  repoPath?: string | null;
  /** Override MCP server list (tests); defaults to the app setting. */
  mcpServers?: McpServerConfig[];
};

export type BuildBrokerToolsResult = {
  registered: string[];
  /** Non-fatal problems (e.g. an MCP server failed to connect). */
  warnings: string[];
  /** Close MCP connections; call when the request finishes. */
  close: () => Promise<void>;
};

/**
 * Register every enabled tool onto the broker, including MCP tools
 * (async: connects to the configured servers).
 */
export async function buildBrokerTools(
  input: BuildBrokerToolsInput,
): Promise<BuildBrokerToolsResult> {
  const { broker, projectPath, toggles } = input;
  const before = new Set(broker.list().map((t) => t.name));
  const warnings: string[] = [];
  const clients: McpClientLike[] = [];

  registerEnabledTools(broker, { projectPath, toggles });

  // Explicit overrides for repo path / contact email (tests, callers that know better).
  if (toggles.repo && input.repoPath !== undefined) {
    broker.registerAll(
      createRepoTools({ projectPath, repoPath: input.repoPath }),
    );
  }
  if (toggles.papers && input.contactEmail) {
    const providers = Object.fromEntries(
      Object.entries(getProviderEnables()),
    ) as Partial<Record<string, boolean>>;
    broker.registerAll(
      registerPapersTools({ contactEmail: input.contactEmail, providers }),
    );
  }

  // `web` has no tools yet; the toggle is stored for when they land.

  if (toggles.mcp) {
    const servers = (input.mcpServers ?? getMcpServers()).filter(
      (s) => s.enabled,
    );
    for (const server of servers) {
      try {
        const client = await connectMcpServer(server);
        clients.push(client);
        broker.registerAll(await createMcpTools(server, client));
      } catch (e) {
        warnings.push(
          `MCP server "${server.name}": ${e instanceof Error ? e.message : "failed"}`,
        );
      }
    }
  }

  return {
    registered: broker
      .list()
      .map((t) => t.name)
      .filter((n) => !before.has(n)),
    warnings,
    close: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}
