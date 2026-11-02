import type { ChatMode } from "@/lib/server/council/types";

import type { GateAction, Stakes, TaskType } from "./taxonomy";

export type RuleHit = {
  layer: "rule" | "forced";
  taskType: TaskType;
  stakes: Stakes;
  needsEvidence: boolean;
  action: GateAction;
  reason: string;
  confidence: number;
  /** Strip slash command from user text when present. */
  cleanedText?: string;
};

const DOI_RE = /\b10\.\d{4,9}\/[^\s]+/i;
const ARXIV_RE = /\b(?:arxiv[:\s-]?)(\d{4}\.\d{4,5})(?:v\d+)?\b/i;

/**
 * Layer 1: explicit overrides and obvious patterns.
 * Returns null if no rule applies.
 */
export function applyRules(input: {
  text: string;
  mode?: ChatMode | "auto";
}): RuleHit | null {
  const raw = input.text.trim();
  const mode = input.mode ?? "auto";

  // Slash overrides
  const slash = raw.match(/^\/(solo|council|probe|evidence)\b([\s\S]*)/i);
  if (slash) {
    const cmd = slash[1]!.toLowerCase();
    const rest = (slash[2] ?? "").trim() || raw;
    if (cmd === "solo") {
      return {
        layer: "rule",
        taskType: "chat",
        stakes: "low",
        needsEvidence: false,
        action: "solo",
        reason: "Explicit /solo override",
        confidence: 1,
        cleanedText: rest,
      };
    }
    if (cmd === "council") {
      return {
        layer: "rule",
        taskType: "other",
        stakes: "medium",
        needsEvidence: false,
        action: "council",
        reason: "Explicit /council override",
        confidence: 1,
        cleanedText: rest,
      };
    }
    if (cmd === "probe") {
      return {
        layer: "rule",
        taskType: "other",
        stakes: "medium",
        needsEvidence: false,
        action: "probe",
        reason: "Explicit /probe override",
        confidence: 1,
        cleanedText: rest,
      };
    }
    return {
      layer: "rule",
      taskType: "factual_lookup",
      stakes: "low",
      needsEvidence: true,
      action: "retrieve_evidence",
      reason: "Explicit /evidence override",
      confidence: 1,
      cleanedText: rest,
    };
  }

  // Forced UI mode
  if (mode === "solo") {
    return {
      layer: "forced",
      taskType: "chat",
      stakes: "low",
      needsEvidence: false,
      action: "solo",
      reason: "User selected Solo mode",
      confidence: 1,
    };
  }
  if (mode === "council") {
    return {
      layer: "forced",
      taskType: "other",
      stakes: "medium",
      needsEvidence: false,
      action: "council",
      reason: "User selected Council mode",
      confidence: 1,
    };
  }

  // DOI / arXiv → factual lookup
  if (DOI_RE.test(raw) || ARXIV_RE.test(raw)) {
    return {
      layer: "rule",
      taskType: "factual_lookup",
      stakes: "low",
      needsEvidence: true,
      action: "retrieve_evidence",
      reason: "Message contains a DOI or arXiv id",
      confidence: 0.95,
    };
  }

  // Repo status patterns
  const lower = raw.toLowerCase();
  if (
    /\b(git\s+status|what\s+changed|recent\s+commits|repo\s+status|diff\s+since)\b/.test(
      lower,
    ) ||
    (/\b(what\s+changed|modified\s+files)\b/.test(lower) &&
      /\b(repo|git|commit)\b/.test(lower))
  ) {
    return {
      layer: "rule",
      taskType: "repo_status",
      stakes: "low",
      needsEvidence: false,
      action: "solo",
      reason: "Looks like a repository status question",
      confidence: 0.9,
    };
  }

  // Ultra-short greetings
  if (/^(hi|hey|hello|thanks|thx|yo|ok|okay)[\s!.]*$/i.test(raw)) {
    return {
      layer: "rule",
      taskType: "chat",
      stakes: "low",
      needsEvidence: false,
      action: "solo",
      reason: "Short chit-chat greeting",
      confidence: 0.92,
    };
  }

  // Explicit hypothesis / experiment asks → always council (research-critical)
  if (
    /\b(propose|generate|suggest)\b.{0,40}\bhypothes/i.test(raw) ||
    /\b\d+\s+hypothes/i.test(raw)
  ) {
    return {
      layer: "rule",
      taskType: "hypothesis_generation",
      stakes: "high",
      needsEvidence: false,
      action: "council",
      reason: "Explicit hypothesis-generation request",
      confidence: 0.93,
    };
  }
  if (
    /\b(design|propose)\b.{0,40}\b(experiment|protocol|ablation)\b/i.test(raw)
  ) {
    return {
      layer: "rule",
      taskType: "experiment_design",
      stakes: "high",
      needsEvidence: false,
      action: "council",
      reason: "Explicit experiment-design request",
      confidence: 0.93,
    };
  }

  // "What is the DOI of …" without a literal DOI still needs evidence
  if (
    /\b(doi|arxiv|citation|cite)\b/i.test(raw) &&
    /\b(what|which|find|look\s*up|original)\b/i.test(raw)
  ) {
    return {
      layer: "rule",
      taskType: "factual_lookup",
      stakes: "low",
      needsEvidence: true,
      action: "retrieve_evidence",
      reason: "Looks like a citation / DOI factual lookup",
      confidence: 0.9,
    };
  }

  return null;
}

/** Difficulty-only baseline for eval:gate (length + keyword heuristics). */
export function difficultyBaseline(text: string): {
  taskType: TaskType;
  stakes: Stakes;
  needsEvidence: boolean;
} {
  const t = text.toLowerCase();
  if (t.length < 20 && /hi|hey|thanks/.test(t)) {
    return { taskType: "chat", stakes: "low", needsEvidence: false };
  }
  if (/hypothesis|hypotheses/.test(t)) {
    return {
      taskType: "hypothesis_generation",
      stakes: "high",
      needsEvidence: false,
    };
  }
  if (/experiment|protocol|a\/b/.test(t)) {
    return {
      taskType: "experiment_design",
      stakes: "high",
      needsEvidence: false,
    };
  }
  if (/literature|survey|novelty|papers?\b/.test(t)) {
    return {
      taskType: "literature_review",
      stakes: "high",
      needsEvidence: true,
    };
  }
  if (/critique|weakness|flaw/.test(t)) {
    return { taskType: "critique", stakes: "high", needsEvidence: false };
  }
  if (/doi|define|what is|citation|arxiv/.test(t)) {
    return {
      taskType: "factual_lookup",
      stakes: "low",
      needsEvidence: true,
    };
  }
  if (/git|commit|repo/.test(t)) {
    return { taskType: "repo_status", stakes: "low", needsEvidence: false };
  }
  if (/fix|code|typescript|python|bug/.test(t)) {
    return { taskType: "code_help", stakes: "low", needsEvidence: false };
  }
  if (/summar|tl;dr|condense/.test(t)) {
    return {
      taskType: "summarize_single",
      stakes: "low",
      needsEvidence: false,
    };
  }
  if (/format|markdown|bullet|table/.test(t)) {
    return { taskType: "formatting", stakes: "low", needsEvidence: false };
  }
  return { taskType: "other", stakes: "medium", needsEvidence: false };
}
