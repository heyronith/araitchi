import { z } from "zod";

import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";
import {
  getContactEmail,
  getMaxSteps,
  getMcpServers,
  getProviderEnables,
  getToolToggles,
  PAPER_PROVIDER_NAMES,
  redactMcpServers,
  setContactEmail,
  setMaxSteps,
  setMcpServers,
  setProviderEnables,
  setToolToggles,
  type McpServerConfig,
} from "@/lib/server/tools/tools-settings";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;
  return Response.json({
    toggles: getToolToggles(projectPath),
    maxSteps: getMaxSteps(projectPath),
    contactEmail: getContactEmail(),
    providers: getProviderEnables(),
    mcpServers: redactMcpServers(getMcpServers()),
    gitHint:
      "Repo tools need the `git` binary on PATH. Install Git if status shows it missing.",
  });
}

const putSchema = z.object({
  toggles: z
    .object({
      papers: z.boolean().optional(),
      web: z.boolean().optional(),
      documents: z.boolean().optional(),
      repo: z.boolean().optional(),
      mcp: z.boolean().optional(),
    })
    .optional(),
  maxSteps: z.number().int().min(1).max(20).optional(),
  contactEmail: z.string().max(200).optional(),
  providers: z.record(z.enum(PAPER_PROVIDER_NAMES), z.boolean()).optional(),
  mcpServers: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        transport: z.enum(["stdio", "http"]),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        url: z.string().optional(),
        headerName: z.string().optional(),
        headerValue: z.string().optional(),
        enabled: z.boolean(),
        readOnly: z.boolean().optional(),
      }),
    )
    .optional(),
});

export async function PUT(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  if (parsed.data.toggles) setToolToggles(projectPath, parsed.data.toggles);
  if (parsed.data.maxSteps != null)
    setMaxSteps(projectPath, parsed.data.maxSteps);
  if (parsed.data.contactEmail != null)
    setContactEmail(parsed.data.contactEmail);
  if (parsed.data.providers) setProviderEnables(parsed.data.providers);
  if (parsed.data.mcpServers) {
    setMcpServers(parsed.data.mcpServers as McpServerConfig[]);
  }

  return Response.json({
    toggles: getToolToggles(projectPath),
    maxSteps: getMaxSteps(projectPath),
    contactEmail: getContactEmail(),
    providers: getProviderEnables(),
    mcpServers: redactMcpServers(getMcpServers()),
  });
}
