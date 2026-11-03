import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLongProjectFixture } from "../src/lib/server/evals/recall-scorer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "evals/recall");
mkdirSync(outDir, { recursive: true });
const fixture = buildLongProjectFixture();
writeFileSync(
  path.join(outDir, "long-project.json"),
  JSON.stringify(fixture, null, 2),
);
console.log(
  `Wrote ${fixture.sessions.length} sessions, ${fixture.facts.length} facts, ${fixture.questions.length} questions`,
);
