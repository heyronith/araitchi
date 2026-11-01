"use client";

import { GitBranch, Menu, Settings } from "lucide-react";

import { ModeSwitch } from "@/components/shell/mode-switch";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type TopBarProps = {
  onOpenSettings: () => void;
  onOpenMobileNav?: () => void;
  projectName?: string | null;
  repoPath?: string | null;
};

export function TopBar({
  onOpenSettings,
  onOpenMobileNav,
  projectName,
  repoPath,
}: TopBarProps) {
  return (
    <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur sm:gap-3 sm:px-4">
      {onOpenMobileNav ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Open navigation"
          onClick={onOpenMobileNav}
        >
          <Menu className="size-4" />
        </Button>
      ) : null}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <p className="truncate text-sm font-medium">
          {projectName ?? "No project open"}
        </p>
        {repoPath ? (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <GitBranch className="size-3" />
            repo
          </Badge>
        ) : null}
      </div>

      <ModeSwitch />
      <ThemeToggle />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Open settings"
        onClick={onOpenSettings}
      >
        <Settings className="size-4" />
      </Button>
    </header>
  );
}
