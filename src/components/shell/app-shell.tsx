"use client";

import * as React from "react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { Composer } from "@/components/shell/composer";
import {
  SettingsDialog,
  fetchSecretStatuses,
  type SecretStatus,
} from "@/components/shell/settings-dialog";
import { TopBar } from "@/components/shell/top-bar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function AppShell() {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [secretStatuses, setSecretStatuses] = React.useState<SecretStatus[]>(
    [],
  );

  const openSettings = () => {
    void fetchSecretStatuses()
      .then((data) => {
        setSecretStatuses(data);
        setSettingsOpen(true);
      })
      .catch(() => {
        toast.error("Could not load key status");
        setSettingsOpen(true);
      });
  };

  return (
    <div className="bg-background flex h-dvh min-h-0 w-full overflow-hidden">
      <div className="hidden md:flex">
        <AppSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[280px] p-0 sm:max-w-[280px]">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <AppSidebar className="w-full border-0" />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenSettings={openSettings}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />

        <main className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              What are you researching?
            </h1>
            <p className="text-muted-foreground mt-3 max-w-md text-sm leading-relaxed sm:text-base">
              Araitchi is a local-first AI research workspace. Chat and projects
              arrive in later tasks — set your API keys in Settings to get
              ready.
            </p>
          </div>
          <Composer />
        </main>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        statuses={secretStatuses}
        onStatusesChange={setSecretStatuses}
      />
    </div>
  );
}
