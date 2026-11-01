"use client";

import { nanoid } from "nanoid";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { ChatPanel } from "@/components/chat/chat-panel";
import { AppSidebar, type ChatListItem } from "@/components/shell/app-sidebar";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<"keys" | "models">(
    "keys",
  );
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [secretStatuses, setSecretStatuses] = React.useState<SecretStatus[]>(
    [],
  );
  const [chats, setChats] = React.useState<ChatListItem[]>([]);
  const [activeChatId, setActiveChatId] = React.useState(() => nanoid());
  const handledQuery = React.useRef<string | null>(null);

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

  React.useEffect(() => {
    // Hydrate sidebar + key status once on mount; restore latest chat if any.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch
    void refreshSecrets();
    void refreshChats().then((list) => {
      if (list && list.length > 0) {
        setActiveChatId((current) => {
          if (list.some((c) => c.id === current)) return current;
          return list[0]!.id;
        });
      }
    });
  }, [refreshSecrets, refreshChats]);

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

  const openSettings = (tab: "keys" | "models" = "keys") => {
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

  const handleNewChat = () => {
    setActiveChatId(nanoid());
    setMobileNavOpen(false);
  };

  return (
    <div className="bg-background flex h-dvh min-h-0 w-full overflow-hidden">
      <div className="hidden md:flex">
        <AppSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          chats={chats}
          activeChatId={activeChatId}
          onNewChat={handleNewChat}
          onSelectChat={(id) => {
            setActiveChatId(id);
          }}
          onRenameChat={async (id, title) => {
            await fetch(`/api/chats/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title }),
            });
            await refreshChats();
          }}
          onDeleteChat={async (id) => {
            await fetch(`/api/chats/${id}`, { method: "DELETE" });
            if (activeChatId === id) {
              setActiveChatId(nanoid());
            }
            await refreshChats();
          }}
        />
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[280px] p-0 sm:max-w-[280px]">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <AppSidebar
            className="w-full border-0"
            chats={chats}
            activeChatId={activeChatId}
            onNewChat={() => {
              handleNewChat();
              setMobileNavOpen(false);
            }}
            onSelectChat={(id) => {
              setActiveChatId(id);
              setMobileNavOpen(false);
            }}
            onRenameChat={async (id, title) => {
              await fetch(`/api/chats/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title }),
              });
              await refreshChats();
            }}
            onDeleteChat={async (id) => {
              await fetch(`/api/chats/${id}`, { method: "DELETE" });
              if (activeChatId === id) setActiveChatId(nanoid());
              await refreshChats();
            }}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenSettings={() => openSettings("keys")}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />

        <ChatPanel
          key={activeChatId}
          chatId={activeChatId}
          hasKey={hasKey}
          onOpenSettings={() => openSettings("keys")}
          onChatUpdated={() => void refreshChats()}
        />
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        statuses={secretStatuses}
        onStatusesChange={setSecretStatuses}
        initialTab={settingsTab}
      />
    </div>
  );
}
