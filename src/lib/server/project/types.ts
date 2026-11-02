export type ProjectJson = {
  id: string;
  name: string;
  createdAt: number;
  schemaVersion: 1;
  repoPath: string | null;
};

export type ProjectLockInfo = {
  pid: number;
  timestamp: number;
};

export type OpenedProject = {
  id: string;
  name: string;
  path: string;
  researchPath: string;
  repoPath: string | null;
  readOnly: boolean;
  lockWarning: string | null;
};

export type RecordType =
  "hypothesis" | "experiment" | "decision" | "paper" | "question" | "note";

export type HypothesisStatus =
  "proposed" | "testing" | "supported" | "refuted" | "inconclusive";
export type ExperimentStatus = "planned" | "running" | "done";
export type QuestionStatus = "open" | "answered";
export type RecordStatus =
  HypothesisStatus | ExperimentStatus | QuestionStatus | null;

export type CreatedBy = "user" | "scribe";

export type MemoryRecord = {
  id: string;
  type: RecordType;
  title: string;
  body: string;
  status: RecordStatus;
  pinned: boolean;
  source: string;
  sourceChatId: string | null;
  sourceMessageId: string | null;
  tags: string[];
  createdBy: CreatedBy;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};
