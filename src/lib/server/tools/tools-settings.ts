import "server-only";

import {
  getProjectSetting,
  setProjectSetting,
} from "@/lib/server/project/settings";
import { getSetting, setSetting } from "@/lib/server/settings";

import type { ToolToggles } from "./types";

export const DEFAULT_TOOL_TOGGLES: ToolToggles = {
  papers: true,
  web: true,
  documents: false,
  repo: false,
  mcp: false,
  memory: true,
};

export const DEFAULT_MAX_STEPS = 8;
export const MAX_STEPS_LIMIT = 20;

export const PAPER_PROVIDER_NAMES = [
  "openalex",
  "core",
  "semantic_scholar",
  "arxiv",
  "dblp",
  "openreview",
  "crossref",
  "unpaywall",
] as const;

export type PaperProviderName = (typeof PAPER_PROVIDER_NAMES)[number];

export type ProviderEnables = Record<PaperProviderName, boolean>;

export const CONTACT_EMAIL_KEY = "contact_email";
export const PROVIDER_ENABLES_KEY = "tools.providers";
export const MCP_SERVERS_KEY = "mcp_servers";

const TOGGLE_KEYS = Object.keys(DEFAULT_TOOL_TOGGLES) as (keyof ToolToggles)[];

function toggleKey(name: keyof ToolToggles): string {
  return `tools.${name}`;
}

export function getToolToggles(projectPath: string): ToolToggles {
  const out = { ...DEFAULT_TOOL_TOGGLES };
  for (const name of TOGGLE_KEYS) {
    const v = getProjectSetting<unknown>(projectPath, toggleKey(name), null);
    if (typeof v === "boolean") out[name] = v;
  }
  return out;
}

export function setToolToggles(
  projectPath: string,
  patch: Partial<ToolToggles>,
): ToolToggles {
  for (const name of TOGGLE_KEYS) {
    const v = patch[name];
    if (typeof v === "boolean") {
      setProjectSetting(projectPath, toggleKey(name), v);
    }
  }
  return getToolToggles(projectPath);
}

export function getMaxSteps(projectPath: string): number {
  const v = getProjectSetting<unknown>(projectPath, "tools.maxSteps", null);
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.min(MAX_STEPS_LIMIT, Math.max(1, Math.floor(v)));
  }
  return DEFAULT_MAX_STEPS;
}

export function setMaxSteps(projectPath: string, value: number): number {
  const n = Math.min(MAX_STEPS_LIMIT, Math.max(1, Math.floor(value)));
  setProjectSetting(projectPath, "tools.maxSteps", n);
  return n;
}

/** Non-secret app-level contact email (sent as `mailto` to polite pools). */
export function getContactEmail(): string {
  const v = getSetting<unknown>(CONTACT_EMAIL_KEY, "");
  const fromSettings = typeof v === "string" ? v.trim() : "";
  if (fromSettings && !fromSettings.toLowerCase().startsWith("paste")) {
    return fromSettings;
  }
  const fromEnv = process.env.ARAITCHI_CONTACT_EMAIL?.trim();
  if (fromEnv && !fromEnv.toLowerCase().startsWith("paste")) return fromEnv;
  return "";
}

export function setContactEmail(email: string): string {
  const trimmed = email.trim();
  setSetting(CONTACT_EMAIL_KEY, trimmed);
  return trimmed;
}

export function getProviderEnables(): ProviderEnables {
  const stored = getSetting<Record<string, unknown>>(PROVIDER_ENABLES_KEY, {});
  const out = {} as ProviderEnables;
  for (const name of PAPER_PROVIDER_NAMES) {
    const v = stored?.[name];
    out[name] = typeof v === "boolean" ? v : true;
  }
  return out;
}

export function setProviderEnables(
  patch: Partial<ProviderEnables>,
): ProviderEnables {
  const next = { ...getProviderEnables() };
  for (const name of PAPER_PROVIDER_NAMES) {
    const v = patch[name];
    if (typeof v === "boolean") next[name] = v;
  }
  setSetting(PROVIDER_ENABLES_KEY, next);
  return next;
}

export type McpServerConfig = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  /** stdio: command + args */
  command?: string;
  args?: string[];
  /** http: Streamable HTTP URL + optional header */
  url?: string;
  headerName?: string;
  headerValue?: string;
  enabled: boolean;
  /** Treat all tools from this server as read-only (no approval). Default false. */
  readOnly?: boolean;
};

export function getMcpServers(): McpServerConfig[] {
  const v = getSetting<unknown>(MCP_SERVERS_KEY, []);
  return Array.isArray(v) ? (v as McpServerConfig[]) : [];
}

export function setMcpServers(servers: McpServerConfig[]): McpServerConfig[] {
  setSetting(MCP_SERVERS_KEY, servers);
  return servers;
}

/** Redact header values before sending configs to the browser. */
export function redactMcpServers(
  servers: McpServerConfig[],
): (Omit<McpServerConfig, "headerValue"> & { hasHeader: boolean })[] {
  return servers.map(({ headerValue, ...rest }) => ({
    ...rest,
    hasHeader: Boolean(headerValue),
  }));
}
