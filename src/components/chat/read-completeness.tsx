"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";

type FileRead = {
  pagesRead: number;
  totalPages: number;
  fullyRead: boolean;
};

type ReadCompletenessProps = {
  chatId: string;
  messageId: string;
  hasReadTool: boolean;
};

export function ReadCompleteness({
  chatId,
  messageId,
  hasReadTool,
}: ReadCompletenessProps) {
  const [files, setFiles] = React.useState<Record<string, FileRead> | null>(
    null,
  );

  React.useEffect(() => {
    if (!hasReadTool) return;
    let cancelled = false;
    const boot = window.setTimeout(() => {
      void fetch(
        `/api/chats/${encodeURIComponent(chatId)}/reads?messageId=${encodeURIComponent(messageId)}`,
      ).then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { files: Record<string, FileRead> };
        if (!cancelled) setFiles(data.files);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(boot);
    };
  }, [chatId, messageId, hasReadTool]);

  if (!hasReadTool || !files || Object.keys(files).length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="read-completeness">
      {Object.entries(files).map(([path, info]) => (
        <Badge
          key={path}
          variant={info.fullyRead ? "default" : "secondary"}
          className="max-w-full truncate font-normal"
          title={path}
        >
          {info.fullyRead
            ? `Read fully (${info.pagesRead}/${info.totalPages})`
            : `Partly read (${info.pagesRead}/${info.totalPages})`}
          {" · "}
          {path.split("/").pop() ?? path}
        </Badge>
      ))}
    </div>
  );
}
