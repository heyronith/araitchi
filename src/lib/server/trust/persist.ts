import "server-only";

import { eq } from "drizzle-orm";

import type { CitationSummary } from "@/lib/server/citations/types";
import { getNotebookDb } from "@/lib/server/project/db";
import { messageTrust } from "@/lib/server/project/schema";

export function saveMessageTrust(
  projectPath: string,
  messageId: string,
  input: {
    citations: CitationSummary;
    claimMap: { sentence: string; markers: string[] }[];
    sourcedCount: number;
    sentenceCount: number;
  },
) {
  const now = Date.now();
  const db = getNotebookDb(projectPath);
  const existing = db
    .select()
    .from(messageTrust)
    .where(eq(messageTrust.messageId, messageId))
    .get();
  const row = {
    messageId,
    citations: JSON.stringify(input.citations),
    claimMap: JSON.stringify(input.claimMap),
    sourcedCount: input.sourcedCount,
    sentenceCount: input.sentenceCount,
    updatedAt: now,
  };
  if (existing) {
    db.update(messageTrust)
      .set(row)
      .where(eq(messageTrust.messageId, messageId))
      .run();
  } else {
    db.insert(messageTrust).values(row).run();
  }
}

export function loadMessageTrust(projectPath: string, messageId: string) {
  const row = getNotebookDb(projectPath)
    .select()
    .from(messageTrust)
    .where(eq(messageTrust.messageId, messageId))
    .get();
  if (!row) return null;
  return {
    citations: JSON.parse(row.citations) as CitationSummary,
    claimMap: JSON.parse(row.claimMap) as {
      sentence: string;
      markers: string[];
    }[],
    sourcedCount: row.sourcedCount,
    sentenceCount: row.sentenceCount,
  };
}
