"use client";

import { Menu, Settings } from "lucide-react";

import { ModeSwitch } from "@/components/shell/mode-switch";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Button } from "@/components/ui/button";

type TopBarProps = {
  onOpenSettings: () => void;
  onOpenMobileNav?: () => void;
};

export function TopBar({ onOpenSettings, onOpenMobileNav }: TopBarProps) {
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

      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground truncate text-sm font-medium">
          No project open
        </p>
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
