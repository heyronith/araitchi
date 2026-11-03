"use client";

import {
  Copy,
  FolderOpen,
  FolderPlus,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "cn";

export type ChatListItem = {
  id: string;
  title: string;
  updatedAt: number;
};

export type ProjectListItem = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
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
  currentProject: { id: string; name: string; path: string } | null;
  recentProjects: ProjectListItem[];
  onOpenFolder: () => void;
  onNewProject: () => void;
  onSwitchProject: (id: string) => void;
  onRemoveProject: (id: string) => void;
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
  currentProject,
  recentProjects,
  onOpenFolder,
  onNewProject,
  onSwitchProject,
  onRemoveProject,
}: AppSidebarProps) {
  const [renameId, setRenameId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [chatQuery, setChatQuery] = React.useState("");
  const [searchHits, setSearchHits] = React.useState<
    {
      chatId: string;
      messageId: string;
      snippet: string;
      createdAt: number;
    }[]
  >([]);
  const [searching, setSearching] = React.useState(false);

  React.useEffect(() => {
    const q = chatQuery.trim();
    if (collapsed || !q) {
      const clear = window.setTimeout(() => {
        setSearchHits([]);
        setSearching(false);
      }, 0);
      return () => window.clearTimeout(clear);
    }
    const handle = window.setTimeout(() => {
      setSearching(true);
      void fetch(`/api/chats/search?q=${encodeURIComponent(q)}&limit=12`)
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as {
            hits: {
              chatId: string;
              messageId: string;
              snippet: string;
              createdAt: number;
            }[];
          };
          setSearchHits(data.hits);
        })
        .finally(() => setSearching(false));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [chatQuery, collapsed]);

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

            {currentProject && !collapsed ? (
              <div className="bg-sidebar-accent/40 mb-2 rounded-md px-2 py-2">
                <div className="flex items-start gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">
                        {currentProject.name}
                      </p>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs break-all">
                      {currentProject.path}
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Copy project path"
                    onClick={() => {
                      void navigator.clipboard.writeText(currentProject.path);
                      toast.success("Path copied");
                    }}
                  >
                    <Copy className="size-3" />
                  </Button>
                </div>
                <p className="text-muted-foreground truncate text-[10px]">
                  {currentProject.path}
                </p>
              </div>
            ) : null}

            <div
              className={cn("flex flex-col gap-1", collapsed && "items-center")}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "justify-start gap-2",
                  collapsed && "size-8 justify-center p-0",
                )}
                onClick={onOpenFolder}
              >
                <FolderOpen className="size-4" />
                {!collapsed ? "Open folder…" : null}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "justify-start gap-2",
                  collapsed && "size-8 justify-center p-0",
                )}
                onClick={onNewProject}
              >
                <FolderPlus className="size-4" />
                {!collapsed ? "New project…" : null}
              </Button>
            </div>

            {!collapsed && recentProjects.length > 0 ? (
              <ul className="mt-2 space-y-0.5">
                {recentProjects
                  .filter((p) => p.id !== currentProject?.id)
                  .slice(0, 8)
                  .map((p) => (
                    <li key={p.id} className="group flex items-center gap-0.5">
                      <button
                        type="button"
                        className="hover:bg-sidebar-accent min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-xs"
                        title={p.path}
                        onClick={() => onSwitchProject(p.id)}
                      >
                        {p.name}
                      </button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100"
                        aria-label="Remove from recents"
                        onClick={() => onRemoveProject(p.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </li>
                  ))}
              </ul>
            ) : null}
          </section>

          <section>
            {!collapsed ? (
              <h2 className="text-muted-foreground mb-2 px-1 text-xs font-medium tracking-wide uppercase">
                Chats
              </h2>
            ) : null}
            {!collapsed ? (
              <div className="relative mb-2" data-testid="sidebar-chat-search">
                <Search className="text-muted-foreground absolute top-2.5 left-2 size-3.5" />
                <Input
                  className="h-8 pl-7 text-xs"
                  placeholder="Search chats…"
                  value={chatQuery}
                  onChange={(e) => setChatQuery(e.target.value)}
                  aria-label="Search past chats"
                />
              </div>
            ) : null}
            {!collapsed && chatQuery.trim() ? (
              <ul className="mb-2 space-y-0.5">
                {searching ? (
                  <li className="text-muted-foreground px-1 text-xs">
                    Searching…
                  </li>
                ) : searchHits.length === 0 ? (
                  <li className="text-muted-foreground px-1 text-xs">
                    No matches.
                  </li>
                ) : (
                  searchHits.map((hit) => (
                    <li key={`${hit.chatId}-${hit.messageId}`}>
                      <button
                        type="button"
                        className="hover:bg-sidebar-accent w-full rounded-md px-2 py-1.5 text-left text-xs"
                        onClick={() => {
                          onSelectChat(hit.chatId);
                          setChatQuery("");
                          setSearchHits([]);
                        }}
                      >
                        <span className="line-clamp-2">{hit.snippet}</span>
                        <span className="text-muted-foreground block text-[10px]">
                          {new Date(hit.createdAt).toLocaleString()}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
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
