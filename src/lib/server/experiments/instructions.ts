import type { ExperimentRow } from "./types";
import { expectedDescription } from "./predictions";

/** Markdown Cursor instructions for a locked experiment. */
export function generateCursorInstructions(exp: ExperimentRow): string {
  const seeds = exp.seeds.join(", ");
  const preds = exp.predictions
    .map((p) => `- \`${p.id}\`: ${expectedDescription(p)}`)
    .join("\n");

  return `# Cursor instructions — ${exp.id} (v${exp.version})

You are implementing a **preregistered** experiment for Araitchi.
The app will **never execute your code**; it only reads \`${exp.resultsPath}\` after you commit.

## Do not touch
- Never edit \`.research/\` (Araitchi owns it).
- Never change the experiment id, lock hash, seeds, or prediction metrics below.

## Goal
**${exp.title}**

${exp.objective}

## Protocol
${exp.protocol}

## Dataset / inputs
${exp.dataset || "_None specified._"}

## Baselines
${exp.baselines || "_None specified._"}

## Environment
${exp.environmentNotes || "_None specified._"}

## Determinism
- Required runs: **${exp.requiredRuns}**
- Seeds (use exactly these): \`${seeds}\`
- Implement under \`experiments/${exp.id}/\` in the **code repo** (not \`.research/\`).

## Locked predictions
${preds}

## Lock
- experimentId: \`${exp.id}\`
- lockHash: \`${exp.lockHash}\`
- lockedAt: ${exp.lockedAt ? new Date(exp.lockedAt).toISOString() : "n/a"}
- repo HEAD at lock: \`${exp.lockRepoHead ?? "unknown"}\`

## Results contract
Write **\`${exp.resultsPath}\`** exactly matching \`.research/experiments/${exp.id}/results.schema.json\`:

\`\`\`json
{
  "experimentId": "${exp.id}",
  "lockHash": "${exp.lockHash}",
  "commit": "<git HEAD sha after your work>",
  "runs": [
    { "seed": <number>, "metrics": { "<metric>": <number>, "...": 0 } }
  ],
  "env": { "node": "...", "os": "..." },
  "notes": "optional"
}
\`\`\`

Include every metric referenced by the predictions (and baselines).

## Commit
Commit with message:

\`\`\`
exp(${exp.id}): <short description>
\`\`\`

Then tell the owner to click **Check results** in Araitchi.
`;
}
