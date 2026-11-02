"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { describeToolCall, type ToolCallView } from "@/lib/chat/tool-events";

type ApprovalDialogProps = {
  call: ToolCallView | null;
  onDecision: (call: ToolCallView, approved: boolean) => void;
  onClose: () => void;
};

/** Approve / deny gate for write or spend tools (e.g. MCP). */
export function ApprovalDialog({
  call,
  onDecision,
  onClose,
}: ApprovalDialogProps) {
  return (
    <AlertDialog open={Boolean(call)} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Allow this tool to run?</AlertDialogTitle>
          <AlertDialogDescription>
            {call ? describeToolCall(call) : ""} may change data or spend money.
            It will not run unless you approve.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {call?.args ? (
          <pre className="bg-muted max-h-40 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
            {JSON.stringify(call.args, null, 2)}
          </pre>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => call && onDecision(call, false)}>
            Deny
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => call && onDecision(call, true)}>
            Approve &amp; retry
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
