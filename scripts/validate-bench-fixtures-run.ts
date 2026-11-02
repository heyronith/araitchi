import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  validateBenchFixturesOffline,
  validateBenchFixturesOnline,
} from "../src/lib/server/bench/validate-fixtures";

function loadEnvLocal(key: string): string | undefined {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return undefined;
  const text = readFileSync(envPath, "utf8");
  const re = new RegExp(`^${key}=(.+)$`, "m");
  const m = text.match(re);
  if (!m) return undefined;
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const online = process.argv.includes("--online");
  const result = validateBenchFixturesOffline(process.cwd());
  console.log("Counts:", result.counts);
  if (!result.ok) {
    console.error(
      `Offline validation failed (${result.issues.length} issues):`,
    );
    for (const i of result.issues.slice(0, 40)) {
      console.error(`  [${i.set}] ${i.id ?? "-"}: ${i.message}`);
    }
    if (result.issues.length > 40) {
      console.error(`  … +${result.issues.length - 40} more`);
    }
    process.exit(1);
  }
  console.log("Offline validation OK");

  if (online) {
    const mailto = loadEnvLocal("ARAITCHI_CONTACT_EMAIL");
    const onlineResult = await validateBenchFixturesOnline(process.cwd(), {
      mailto,
    });
    console.log(
      `Online resolution: ${onlineResult.resolved}/${onlineResult.total} DOIs resolved (${onlineResult.pct.toFixed(1)}%)`,
    );
    if (onlineResult.failures.length) {
      console.error(
        `Unresolved (${onlineResult.failures.length}): ${onlineResult.failures.slice(0, 15).join(", ")}${onlineResult.failures.length > 15 ? " …" : ""}`,
      );
    }
    if (!onlineResult.ok) process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
