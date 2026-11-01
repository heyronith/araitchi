"use client";

import { FolderOpen, MessageSquarePlus, PanelLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "cn";

type AppSidebarProps = {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
};

export function AppSidebar({
  collapsed = false,
  onToggleCollapse,
  className,
}: AppSidebarProps) {
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
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block w-full">
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "w-full justify-start gap-2",
                  collapsed && "justify-center px-0",
                )}
                disabled
              >
                <MessageSquarePlus className="size-4" />
                {!collapsed ? <span>New chat</span> : null}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">Coming in Task 2</TooltipContent>
        </Tooltip>
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
              <p className="text-muted-foreground px-1 text-xs">
                No chats yet.
              </p>
            ) : (
              <div className="text-muted-foreground flex justify-center py-2 text-xs">
                —
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}
