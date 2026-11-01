"use client";

import { Check, ChevronsUpDown, RefreshCw, Star } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "cn";

export type ModelOption = {
  id: string;
  name: string;
  lab: string;
  contextLength: number | null;
  priceInPerMtok: number | null;
  priceOutPerMtok: number | null;
  modalities: string[];
  supportsTools: boolean;
  supportsStructuredOutputs: boolean;
  supportsReasoning: boolean;
};

function formatPrice(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatContext(n: number | null) {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

type ModelPickerProps = {
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
};

export function ModelPicker({ value, onChange, disabled }: ModelPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [models, setModels] = React.useState<ModelOption[]>([]);
  const [favourites, setFavourites] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/models${refresh ? "?refresh=1" : ""}`);
        if (!res.ok) throw new Error("failed");
        const data = (await res.json()) as {
          models: ModelOption[];
          favourites: string[];
          defaultModelId: string | null;
        };
        setModels(data.models);
        setFavourites(data.favourites);
        if (!value && data.defaultModelId) {
          onChange(data.defaultModelId);
        } else if (!value && data.models[0]) {
          onChange(data.models[0].id);
        }
      } catch {
        // ignore; composer may show empty
      } finally {
        setLoading(false);
      }
    },
    [onChange, value],
  );

  React.useEffect(() => {
    // Initial catalog fetch for the composer picker.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const selected = models.find((m) => m.id === value) ?? null;

  const favSet = new Set(favourites);
  const favModels = models.filter((m) => favSet.has(m.id));
  const byLab = new Map<string, ModelOption[]>();
  for (const m of models) {
    if (favSet.has(m.id)) continue;
    const list = byLab.get(m.lab) ?? [];
    list.push(m);
    byLab.set(m.lab, list);
  }

  async function toggleFavourite(id: string) {
    const next = favSet.has(id)
      ? favourites.filter((f) => f !== id)
      : [...favourites, id];
    setFavourites(next);
    await fetch("/api/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favourites: next }),
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="max-w-[220px] justify-between gap-2"
          aria-label="Select model"
        >
          <span className="truncate">
            {selected ? selected.name : loading ? "Loading…" : "Select model"}
          </span>
          <ChevronsUpDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        <Command>
          <div className="flex items-center gap-1 border-b pr-1">
            <CommandInput placeholder="Search models…" className="border-0" />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Refresh models"
              disabled={loading}
              onClick={() => void load(true)}
            >
              <RefreshCw
                className={cn("size-3.5", loading && "animate-spin")}
              />
            </Button>
          </div>
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            {favModels.length > 0 ? (
              <CommandGroup heading="Favourites">
                {favModels.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    selected={m.id === value}
                    favourite
                    onSelect={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                    onToggleFavourite={() => void toggleFavourite(m.id)}
                  />
                ))}
              </CommandGroup>
            ) : null}
            {[...byLab.entries()].map(([lab, list]) => (
              <CommandGroup key={lab} heading={lab}>
                {list.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    selected={m.id === value}
                    favourite={false}
                    onSelect={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                    onToggleFavourite={() => void toggleFavourite(m.id)}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ModelRow({
  model,
  selected,
  favourite,
  onSelect,
  onToggleFavourite,
}: {
  model: ModelOption;
  selected: boolean;
  favourite: boolean;
  onSelect: () => void;
  onToggleFavourite: () => void;
}) {
  const vision = model.modalities.includes("image");
  return (
    <CommandItem
      value={`${model.id} ${model.name} ${model.lab}`}
      onSelect={onSelect}
      className="items-start gap-2 py-2"
    >
      <Check
        className={cn(
          "mt-0.5 size-3.5",
          selected ? "opacity-100" : "opacity-0",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{model.name}</div>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px]">
          <span>
            {formatPrice(model.priceInPerMtok)} ·{" "}
            {formatPrice(model.priceOutPerMtok)} /1M
          </span>
          <span>{formatContext(model.contextLength)} ctx</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {model.supportsTools ? (
            <Badge variant="secondary">tools</Badge>
          ) : null}
          {vision ? <Badge variant="secondary">vision</Badge> : null}
          {model.supportsReasoning ? (
            <Badge variant="secondary">reasoning</Badge>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground mt-0.5"
        aria-label={favourite ? "Unpin favourite" : "Pin favourite"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavourite();
        }}
      >
        <Star
          className={cn("size-3.5", favourite && "fill-current text-amber-500")}
        />
      </button>
    </CommandItem>
  );
}
