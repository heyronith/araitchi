"use client";

import {
  FolderOpen,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "cn";
import * as React from "react";

export type ChatListItem = {
  id: string;
  title: string;
  updatedAt: number;
};

type AppSidebarProps = {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
  chats: ChatListItem[];
  activeChatId: string | null;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
};

export function AppSidebar({
  collapsed = false,
  onToggleCollapse,
  className,
  chats,
  activeChatId,
  onNewChat,
  onSelectChat,
  onRenameChat,
  onDeleteChat,
}: AppSidebarProps) {
  const [renameId, setRenameId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  return (
    <aside
      className={cn(
        "bg-sidebar text-sidebar-foreground border-sidebar-border flex h-full flex-col border-r transition-[width] duration-200",
        collapsed ? "w-[56px]" : "w-[260px]",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2 px-3",
          collapsed && "justify-center px-2",
        )}
      >
        {!collapsed ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm font-semibold tracking-tight">
              Araitchi
            </span>
          </div>
        ) : null}
        {onToggleCollapse ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapse}
          >
            <PanelLeft className="size-4" />
          </Button>
        ) : null}
      </div>

      <div className={cn("px-3 pb-3", collapsed && "px-2")}>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start gap-2",
            collapsed && "justify-center px-0",
          )}
          onClick={onNewChat}
        >
          <MessageSquarePlus className="size-4" />
          {!collapsed ? <span>New chat</span> : null}
        </Button>
      </div>

      <Separator />

      <ScrollArea className="flex-1">
        <div className={cn("space-y-6 px-3 py-4", collapsed && "px-2")}>
          <section>
            {!collapsed ? (
              <h2 className="text-muted-foreground mb-2 px-1 text-xs font-medium tracking-wide uppercase">
                Projects
              </h2>
            ) : null}
            <div
              className={cn(
                "text-muted-foreground border-sidebar-border flex flex-col items-start gap-2 rounded-lg border border-dashed px-3 py-4 text-xs",
                collapsed && "items-center px-1 py-3",
              )}
            >
              <FolderOpen className="size-4 shrink-0 opacity-70" />
              {!collapsed ? <p>Open a project folder — coming soon</p> : null}
            </div>
          </section>

          <section>
            {!collapsed ? (
              <h2 className="text-muted-foreground mb-2 px-1 text-xs font-medium tracking-wide uppercase">
                Chats
              </h2>
            ) : null}
            {!collapsed ? (
              chats.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs">
                  No chats yet.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {chats.map((chat) => (
                    <li key={chat.id} className="group relative">
                      {renameId === chat.id ? (
                        <form
                          className="px-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void onRenameChat(chat.id, renameValue).then(() =>
                              setRenameId(null),
                            );
                          }}
                        >
                          <Input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => setRenameId(null)}
                            aria-label="Rename chat"
                            className="h-8"
                          />
                        </form>
                      ) : (
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => onSelectChat(chat.id)}
                            className={cn(
                              "hover:bg-sidebar-accent min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm",
                              activeChatId === chat.id && "bg-sidebar-accent",
                            )}
                          >
                            {chat.title}
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="opacity-0 group-hover:opacity-100"
                                aria-label="Chat actions"
                              >
                                <MoreHorizontal className="size-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setRenameId(chat.id);
                                  setRenameValue(chat.title);
                                }}
                              >
                                <Pencil className="size-3.5" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setDeleteId(chat.id)}
                              >
                                <Trash2 className="size-3.5" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <div className="text-muted-foreground flex justify-center py-2 text-xs">
                {chats.length || "—"}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>

      <AlertDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the chat and its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) {
                  void onDeleteChat(deleteId).then(() => setDeleteId(null));
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
