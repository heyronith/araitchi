import "server-only";

import { loadDefaults } from "@/lib/server/defaults";
import {
  getProjectSetting,
  setProjectSetting,
} from "@/lib/server/project/settings";

import { ALWAYS_COUNCIL, type TaskType } from "./taxonomy";

export type GateSettings = {
  /** Min weighted kNN confidence to accept without LLM (0–1). */
  knnThreshold: number;
  /** Probe structured-agreement threshold (0–1). Matching finals score ≥0.7. */
  probeAgreementThreshold: number;
  /** When false, probe is skipped and "other"/probe routes go to council. */
  probeEnabled: boolean;
  /** OpenRouter model id for classifier LLM (production LLM-first). */
  classifierModel: string;
  /** Two probe model ids from different labs. */
  probeModels: [string, string];
  /** Editable always-council task types. */
  alwaysCouncil: TaskType[];
  /** k for weighted kNN. */
  knnK: number;
  /** Over-budget behaviour: block | warn | allow. */
  budgetBehaviour: "block" | "warn" | "allow";
};

function gateDefaultsFromConfig(): Pick<
  GateSettings,
  "classifierModel" | "probeModels"
> {
  const d = loadDefaults();
  return {
    classifierModel: d.classifierModel,
    probeModels: d.probeModels,
  };
}

/**
 * Quality-first defaults from config/defaults.json (override after eval:gate /
 * eval:probe). Probe pair may be latest aliases; Settings → Routing can pin
 * concrete catalog ids for local mock / e2e.
 */
export const DEFAULT_GATE_SETTINGS: GateSettings = {
  knnThreshold: 0.55,
  /** Structured compare: matching finals → ≥0.7; mismatch → 0. */
  probeAgreementThreshold: 0.7,
  /** T11 eval: structured probe acc 59% (<85%) → disabled; other → council. */
  probeEnabled: false,
  ...gateDefaultsFromConfig(),
  alwaysCouncil: [...ALWAYS_COUNCIL] as TaskType[],
  knnK: 7,
  budgetBehaviour: "block",
};

export function getGateSettings(projectPath: string): GateSettings {
  const knnThreshold = getProjectSetting<number>(
    projectPath,
    "gate.knnThreshold",
    DEFAULT_GATE_SETTINGS.knnThreshold,
  );
  const probeAgreementThreshold = getProjectSetting<number>(
    projectPath,
    "gate.probeAgreementThreshold",
    DEFAULT_GATE_SETTINGS.probeAgreementThreshold,
  );
  const probeEnabled = getProjectSetting<boolean>(
    projectPath,
    "gate.probeEnabled",
    DEFAULT_GATE_SETTINGS.probeEnabled,
  );
  const classifierModel = getProjectSetting<string>(
    projectPath,
    "gate.classifierModel",
    DEFAULT_GATE_SETTINGS.classifierModel,
  );
  const probeModels = getProjectSetting<[string, string]>(
    projectPath,
    "gate.probeModels",
    DEFAULT_GATE_SETTINGS.probeModels,
  );
  const alwaysCouncil = getProjectSetting<TaskType[]>(
    projectPath,
    "gate.alwaysCouncil",
    DEFAULT_GATE_SETTINGS.alwaysCouncil,
  );
  const knnK = getProjectSetting<number>(
    projectPath,
    "gate.knnK",
    DEFAULT_GATE_SETTINGS.knnK,
  );
  const budgetBehaviour = getProjectSetting<GateSettings["budgetBehaviour"]>(
    projectPath,
    "gate.budgetBehaviour",
    DEFAULT_GATE_SETTINGS.budgetBehaviour,
  );
  return {
    knnThreshold: clamp01(knnThreshold, DEFAULT_GATE_SETTINGS.knnThreshold),
    probeAgreementThreshold: clamp01(
      probeAgreementThreshold,
      DEFAULT_GATE_SETTINGS.probeAgreementThreshold,
    ),
    probeEnabled: typeof probeEnabled === "boolean" ? probeEnabled : true,
    classifierModel:
      classifierModel?.trim() || DEFAULT_GATE_SETTINGS.classifierModel,
    probeModels:
      Array.isArray(probeModels) &&
      probeModels.length >= 2 &&
      typeof probeModels[0] === "string" &&
      typeof probeModels[1] === "string"
        ? [probeModels[0], probeModels[1]]
        : DEFAULT_GATE_SETTINGS.probeModels,
    alwaysCouncil:
      Array.isArray(alwaysCouncil) && alwaysCouncil.length
        ? alwaysCouncil
        : DEFAULT_GATE_SETTINGS.alwaysCouncil,
    knnK:
      typeof knnK === "number" && Number.isFinite(knnK)
        ? Math.max(1, Math.min(31, Math.floor(knnK)))
        : DEFAULT_GATE_SETTINGS.knnK,
    budgetBehaviour:
      budgetBehaviour === "warn" || budgetBehaviour === "allow"
        ? budgetBehaviour
        : "block",
  };
}

export function setGateSettings(
  projectPath: string,
  patch: Partial<GateSettings>,
): GateSettings {
  if (typeof patch.knnThreshold === "number") {
    setProjectSetting(projectPath, "gate.knnThreshold", patch.knnThreshold);
  }
  if (typeof patch.probeAgreementThreshold === "number") {
    setProjectSetting(
      projectPath,
      "gate.probeAgreementThreshold",
      patch.probeAgreementThreshold,
    );
  }
  if (typeof patch.probeEnabled === "boolean") {
    setProjectSetting(projectPath, "gate.probeEnabled", patch.probeEnabled);
  }
  if (typeof patch.classifierModel === "string") {
    setProjectSetting(
      projectPath,
      "gate.classifierModel",
      patch.classifierModel,
    );
  }
  if (patch.probeModels) {
    setProjectSetting(projectPath, "gate.probeModels", patch.probeModels);
  }
  if (patch.alwaysCouncil) {
    setProjectSetting(projectPath, "gate.alwaysCouncil", patch.alwaysCouncil);
  }
  if (typeof patch.knnK === "number") {
    setProjectSetting(projectPath, "gate.knnK", patch.knnK);
  }
  if (patch.budgetBehaviour) {
    setProjectSetting(
      projectPath,
      "gate.budgetBehaviour",
      patch.budgetBehaviour,
    );
  }
  return getGateSettings(projectPath);
}

function clamp01(n: number, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}
