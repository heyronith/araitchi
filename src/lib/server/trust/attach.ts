import "server-only";

import { checkCitations } from "@/lib/server/citations/check";
import {
  formatCitationSummaryLine,
  type CitationSummary,
} from "@/lib/server/citations/types";
import {
  formatTraceabilityFooter,
  traceSentences,
  type SourceCatalog,
} from "@/lib/server/traceability/markers";

import { saveMessageTrust } from "./persist";

export type TrustAttachResult = {
  citations: CitationSummary;
  summaryLine: string;
  traceFooter: string;
  claimMap: { sentence: string; markers: string[] }[];
  sourcedCount: number;
  sentenceCount: number;
  part: {
    type: "data-trust";
    data: {
      citations: CitationSummary;
      summaryLine: string;
      traceFooter: string;
      claimMap: { sentence: string; markers: string[] }[];
      sourcedCount: number;
      sentenceCount: number;
    };
  };
};

/** Run citation + traceability analysis and optionally persist on the message. */
export async function attachTrustMeta(input: {
  projectPath: string;
  messageId: string;
  text: string;
  catalog?: SourceCatalog;
  skipSupport?: boolean;
}): Promise<TrustAttachResult> {
  const citations = await checkCitations(input.text, {
    skipSupport: input.skipSupport ?? true,
  });
  const traced = traceSentences(input.text, input.catalog);
  const summaryLine = formatCitationSummaryLine(citations);
  const traceFooter = formatTraceabilityFooter(
    traced.sourcedCount,
    traced.total,
  );

  saveMessageTrust(input.projectPath, input.messageId, {
    citations,
    claimMap: traced.claimMap,
    sourcedCount: traced.sourcedCount,
    sentenceCount: traced.total,
  });

  const data = {
    citations,
    summaryLine,
    traceFooter,
    claimMap: traced.claimMap,
    sourcedCount: traced.sourcedCount,
    sentenceCount: traced.total,
  };

  return {
    ...data,
    part: { type: "data-trust", data },
  };
}
