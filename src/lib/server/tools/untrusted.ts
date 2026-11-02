import "server-only";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Wrap tool output so the model treats it as untrusted data, not instructions. */
export function wrapUntrustedToolResult(
  tool: string,
  source: string,
  body: string,
): string {
  // Prevent the body from closing the wrapper early.
  const safeBody = body.replace(/<\/tool_result/gi, "&lt;/tool_result");
  return `<tool_result tool="${escapeAttr(tool)}" source="${escapeAttr(source)}" untrusted="true">\n${safeBody}\n</tool_result>`;
}

export function truncateForModel(text: string, maxChars = 12000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated]`;
}
