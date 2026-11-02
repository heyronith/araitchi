import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

const cache = new Map<string, string>();

export function loadPrompt(name: string): string {
  const cached = cache.get(name);
  if (cached) return cached;
  const file = path.join(process.cwd(), "src/lib/server/prompts", name);
  const text = readFileSync(file, "utf8");
  cache.set(name, text);
  return text;
}
