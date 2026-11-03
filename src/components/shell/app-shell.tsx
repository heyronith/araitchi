"use client";

import { nanoid } from "nanoid";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { ChatPanel } from "@/components/chat/chat-panel";
import {
  AppSidebar,
  type ChatListItem,
  type ProjectListItem,
} from "@/components/shell/app-sidebar";
import { MemoryPanel } from "@/components/shell/memory-panel";
import { OnboardingWizard } from "@/components/shell/onboarding-wizard";
import { OpenFolderDialog } from "@/components/shell/open-folder-dialog";
import {
  SettingsDialog,
  fetchSecretStatuses,
  type SecretStatus,
} from "@/components/shell/settings-dialog";
import type { ChatMode } from "@/components/shell/mode-switch";
import { TopBar } from "@/components/shell/top-bar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type CurrentProject = {
  id: string;
  name: string;
  path: string;
  repoPath: string | null;
  lockWarning: string | null;
};

const MEMORY_COLLAPSE_KEY = "araitchi.memoryPanel.collapsed";

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<
    | "keys"
    | "models"
    | "council"
    | "tools"
    | "memory"
    | "instructions"
    | "routing"
    | "evals"
  >("keys");
  const [chatMode, setChatMode] = React.useState<ChatMode>("auto");
  const [onboardingOpen, setOnboardingOpen] = React.useState(false);

  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [memoryCollapsed, setMemoryCollapsed] = React.useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(MEMORY_COLLAPSE_KEY) === "1";
  });
  const [secretStatuses, setSecretStatuses] = React.useState<SecretStatus[]>(
    [],
  );
  const [chats, setChats] = React.useState<ChatListItem[]>([]);
  const [activeChatId, setActiveChatId] = React.useState(() => nanoid());
  const [currentProject, setCurrentProject] =
    React.useState<CurrentProject | null>(null);
  const [recentProjects, setRecentProjects] = React.useState<ProjectListItem[]>(
    [],
  );
  const [folderOpen, setFolderOpen] = React.useState(false);
  const [folderMode, setFolderMode] = React.useState<"open" | "new">("open");
  const [memoryRefresh, setMemoryRefresh] = React.useState(0);
  const handledQuery = React.useRef<string | null>(null);
  const lockWarned = React.useRef<string | null>(null);

  const hasKey =
    secretStatuses.find((s) => s.name === "openrouter_api_key")?.set ?? false;

  const refreshSecrets = React.useCallback(async () => {
    try {
      setSecretStatuses(await fetchSecretStatuses());
    } catch {
      // ignore
    }
  }, []);

  const refreshChats = React.useCallback(async () => {
    const res = await fetch("/api/chats");
    if (!res.ok) return;
    const data = (await res.json()) as { chats: ChatListItem[] };
    setChats(data.chats);
    return data.chats;
  }, []);

  const refreshProjects = React.useCallback(async () => {
    const res = await fetch("/api/projects");
    if (!res.ok) return;
    const data = (await res.json()) as {
      current: CurrentProject | null;
      recent: ProjectListItem[];
    };
    setCurrentProject(data.current);
    setRecentProjects(data.recent);
    if (data.current?.lockWarning && lockWarned.current !== data.current.id) {
      lockWarned.current = data.current.id;
      toast.warning(data.current.lockWarning);
    }
    return data;
  }, []);

  const modeFetchGen = React.useRef(0);
  const refreshMode = React.useCallback(async () => {
    const gen = ++modeFetchGen.current;
    const res = await fetch("/api/council/config");
    if (!res.ok || gen !== modeFetchGen.current) return;
    const data = (await res.json()) as { mode: ChatMode };
    if (gen !== modeFetchGen.current) return;
    setChatMode(
      data.mode === "council" || data.mode === "solo" || data.mode === "auto"
        ? data.mode
        : "auto",
    );
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch
    void refreshSecrets();
    void refreshProjects().then(() => {
      void refreshMode();
      void refreshChats().then((list) => {
        if (list && list.length > 0) {
          setActiveChatId((current) => {
            if (list.some((c) => c.id === current)) return current;
            return list[0]!.id;
          });
        }
      });
    });
    void fetch("/api/onboarding")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { isComplete: boolean };
        if (!data.isComplete) setOnboardingOpen(true);
      })
      .catch(() => undefined);
  }, [refreshSecrets, refreshChats, refreshProjects, refreshMode]);

  React.useEffect(() => {
    window.localStorage.setItem(
      MEMORY_COLLAPSE_KEY,
      memoryCollapsed ? "1" : "0",
    );
  }, [memoryCollapsed]);

  React.useEffect(() => {
    const connected = searchParams.get("connected");
    const connectError = searchParams.get("connect_error");
    const key = `${connected ?? ""}:${connectError ?? ""}`;
    if (!connected && !connectError) return;
    if (handledQuery.current === key) return;
    handledQuery.current = key;

    if (connected === "openrouter") {
      toast.success("Connected to OpenRouter");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- OAuth return
      void refreshSecrets();
      router.replace("/");
    } else if (connectError) {
      toast.error(`OpenRouter connect failed: ${connectError}`);
      router.replace("/");
    }
  }, [searchParams, router, refreshSecrets]);

  const openSettings = (
    tab:
      | "keys"
      | "models"
      | "council"
      | "tools"
      | "memory"
      | "instructions"
      | "routing"
      | "evals" = "keys",
  ) => {
    setSettingsTab(tab);
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

  const handleModeChange = async (mode: ChatMode) => {
    // Bump gen so an in-flight refreshMode cannot overwrite the user choice.
    modeFetchGen.current += 1;
    setChatMode(mode);
    try {
      const res = await fetch("/api/council/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) toast.error("Could not save chat mode");
    } catch {
      toast.error("Could not save chat mode");
    }
  };

  const handleNewChat = () => {
    setActiveChatId(nanoid());
    setMobileNavOpen(false);
  };

  const afterProjectChange = async () => {
    await refreshProjects();
    await refreshMode();
    const list = await refreshChats();
    setActiveChatId(list && list.length > 0 ? list[0]!.id : nanoid());
    setMemoryRefresh((n) => n + 1);
  };

  const sidebarProps = {
    chats,
    activeChatId,
    onNewChat: handleNewChat,
    onSelectChat: (id: string) => setActiveChatId(id),
    onRenameChat: async (id: string, title: string) => {
      await fetch(`/api/chats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      await refreshChats();
    },
    onDeleteChat: async (id: string) => {
      await fetch(`/api/chats/${id}`, { method: "DELETE" });
      if (activeChatId === id) setActiveChatId(nanoid());
      await refreshChats();
    },
    currentProject: currentProject
      ? {
          id: currentProject.id,
          name: currentProject.name,
          path: currentProject.path,
        }
      : null,
    recentProjects,
    onOpenFolder: () => {
      setFolderMode("open");
      setFolderOpen(true);
    },
    onNewProject: () => {
      setFolderMode("new");
      setFolderOpen(true);
    },
    onSwitchProject: (id: string) => {
      void fetch("/api/projects/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      }).then(async (res) => {
        if (!res.ok) {
          toast.error("Could not switch project");
          return;
        }
        await afterProjectChange();
      });
    },
    onRemoveProject: (id: string) => {
      void fetch(`/api/projects/${id}`, { method: "DELETE" }).then(() =>
        refreshProjects(),
      );
    },
  };

  return (
    <div className="bg-background flex h-dvh min-h-0 w-full overflow-hidden">
      <div className="hidden md:flex">
        <AppSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          {...sidebarProps}
        />
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[280px] p-0 sm:max-w-[280px]">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <AppSidebar
            className="w-full border-0"
            {...sidebarProps}
            onNewChat={() => {
              handleNewChat();
              setMobileNavOpen(false);
            }}
            onSelectChat={(id) => {
              setActiveChatId(id);
              setMobileNavOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenSettings={() => openSettings("keys")}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          projectName={currentProject?.name}
          repoPath={currentProject?.repoPath}
          mode={chatMode}
          onModeChange={handleModeChange}
        />

        <ChatPanel
          key={`${activeChatId}:${chatMode}`}
          chatId={activeChatId}
          hasKey={hasKey}
          mode={chatMode}
          onOpenSettings={(tab) => openSettings(tab ?? "keys")}
          onChatUpdated={() => void refreshChats()}
          onMemorySaved={() => setMemoryRefresh((n) => n + 1)}
        />
      </div>

      <div className="hidden lg:flex">
        <MemoryPanel
          collapsed={memoryCollapsed}
          onToggle={() => setMemoryCollapsed((v) => !v)}
          refreshKey={memoryRefresh}
        />
      </div>

      <OpenFolderDialog
        open={folderOpen}
        onOpenChange={setFolderOpen}
        mode={folderMode}
        onOpened={async () => {
          await afterProjectChange();
          toast.success("Project opened");
        }}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        statuses={secretStatuses}
        onStatusesChange={setSecretStatuses}
        initialTab={settingsTab}
      />

      <OnboardingWizard
        open={onboardingOpen}
        onComplete={() => setOnboardingOpen(false)}
        onOpenProject={() => {
          setFolderMode("open");
          setFolderOpen(true);
        }}
        onNewProject={() => {
          setFolderMode("new");
          setFolderOpen(true);
        }}
        onOpenSettingsTools={() => openSettings("tools")}
      />
    </div>
  );
}
