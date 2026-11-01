export type StoredMessage = {
  id: string;
  chatId: string;
  parentId: string | null;
  role: "user" | "assistant" | "system";
  parts: unknown[];
  modelId: string | null;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
  } | null;
  createdAt: number;
};

export type BranchNode = StoredMessage & {
  children: BranchNode[];
};

/** Build a forest of message trees from a flat parent_id list. */
export function buildMessageForest(messages: StoredMessage[]): BranchNode[] {
  const byId = new Map<string, BranchNode>();
  for (const m of messages) {
    byId.set(m.id, { ...m, children: [] });
  }

  const roots: BranchNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRecursive = (nodes: BranchNode[]) => {
    nodes.sort((a, b) => a.createdAt - b.createdAt);
    for (const n of nodes) sortRecursive(n.children);
  };
  sortRecursive(roots);
  return roots;
}

/**
 * Walk the active branch: at each node with siblings, pick the sibling
 * matching `activeLeafId`'s ancestor chain, else the latest child.
 */
export function resolveActiveBranch(
  messages: StoredMessage[],
  activeLeafId?: string | null,
): StoredMessage[] {
  if (messages.length === 0) return [];

  const byParent = new Map<string | null, StoredMessage[]>();
  for (const m of messages) {
    const key = m.parentId;
    const list = byParent.get(key) ?? [];
    list.push(m);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt);
  }

  const ancestors = new Set<string>();
  if (activeLeafId) {
    const byId = new Map(messages.map((m) => [m.id, m]));
    let cur: StoredMessage | undefined = byId.get(activeLeafId);
    while (cur) {
      ancestors.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }

  const path: StoredMessage[] = [];
  let parentId: string | null = null;
  for (;;) {
    const siblings: StoredMessage[] = byParent.get(parentId) ?? [];
    if (siblings.length === 0) break;
    const preferred: StoredMessage =
      siblings.find((s: StoredMessage) => ancestors.has(s.id)) ??
      siblings[siblings.length - 1]!;
    path.push(preferred);
    parentId = preferred.id;
  }
  return path;
}

/** Sibling index for a message among children of the same parent. */
export function getBranchMeta(
  messages: StoredMessage[],
  messageId: string,
): { index: number; total: number } {
  const msg = messages.find((m) => m.id === messageId);
  if (!msg) return { index: 0, total: 1 };
  const siblings = messages
    .filter((m) => m.parentId === msg.parentId && m.role === msg.role)
    .sort((a, b) => a.createdAt - b.createdAt);
  const index = Math.max(
    0,
    siblings.findIndex((s) => s.id === messageId),
  );
  return { index: index + 1, total: Math.max(1, siblings.length) };
}

export function truncateTitle(text: string, max = 60): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned || "New chat";
  return `${cleaned.slice(0, max - 1)}…`;
}
