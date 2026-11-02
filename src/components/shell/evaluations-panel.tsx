"use client";

import * as React from "react";

import type {
  BenchReport,
  BenchTableRow,
  EvalDoc,
  EvalsApiResponse,
} from "@/lib/evals-types";
import { Badge } from "@/components/ui/badge";

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

function MetricBarChart({
  title,
  rows,
  valueKey,
  format = (n) => n.toFixed(2),
}: {
  title: string;
  rows: Array<{ label: string; row: BenchTableRow }>;
  valueKey: keyof BenchTableRow;
  format?: (n: number) => string;
}) {
  const values = rows.map((r) => {
    const v = r.row[valueKey];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  });
  const max = Math.max(...values, 1e-9);

  return (
    <div className="space-y-2" data-testid={`evals-chart-${valueKey}`}>
      <p className="text-sm font-medium">{title}</p>
      <div className="space-y-2" data-testid="evals-bar-chart">
        <svg
          viewBox={`0 0 320 ${rows.length * 28 + 8}`}
          className="text-foreground w-full max-w-md"
          role="img"
          aria-label={title}
        >
          {rows.map((r, i) => {
            const raw = r.row[valueKey];
            const v = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
            const w = Math.max(2, (v / max) * 200);
            const y = 8 + i * 28;
            return (
              <g key={r.label}>
                <text
                  x={0}
                  y={y + 12}
                  className="fill-current"
                  style={{ fontSize: 11 }}
                >
                  {r.label}
                </text>
                <rect
                  x={72}
                  y={y}
                  width={w}
                  height={16}
                  rx={3}
                  className="fill-primary/80"
                />
                <text
                  x={80 + w}
                  y={y + 12}
                  className="fill-current opacity-70"
                  style={{ fontSize: 10 }}
                >
                  {format(v)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function BenchTables({ report }: { report: BenchReport }) {
  const entries = Object.entries(report.tables).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const chartRows = entries.map(([label, row]) => ({ label, row }));

  return (
    <div className="space-y-5" data-testid="evals-bench">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">Benchmark</p>
          <Badge variant="secondary">
            {report.options.dryRun ? "dry-run" : "live"}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {report.generatedAt.slice(0, 10)}
          </span>
        </div>
        {report.findings.length > 0 ? (
          <ul className="text-muted-foreground list-inside list-disc text-xs">
            {report.findings.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table
          className="w-full min-w-[36rem] text-left text-xs"
          data-testid="evals-bench-table"
        >
          <thead className="bg-muted/50">
            <tr>
              <th className="px-2 py-1.5 font-medium">Set:Config</th>
              <th className="px-2 py-1.5 font-medium">Mean score</th>
              <th className="px-2 py-1.5 font-medium">95% CI</th>
              <th className="px-2 py-1.5 font-medium">Mean cost</th>
              <th className="px-2 py-1.5 font-medium">Cost/correct</th>
              <th className="px-2 py-1.5 font-medium">Latency</th>
              <th className="px-2 py-1.5 font-medium">N</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, row]) => (
              <tr key={key} className="border-t">
                <td className="px-2 py-1.5 font-medium">{key}</td>
                <td className="px-2 py-1.5">{row.meanScore.toFixed(3)}</td>
                <td className="px-2 py-1.5">
                  [{row.ciLow.toFixed(3)}, {row.ciHigh.toFixed(3)}]
                </td>
                <td className="px-2 py-1.5">{formatUsd(row.meanCost)}</td>
                <td className="px-2 py-1.5">{formatUsd(row.costPerCorrect)}</td>
                <td className="px-2 py-1.5">
                  {Math.round(row.meanLatencyMs)} ms
                </td>
                <td className="px-2 py-1.5">{row.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <MetricBarChart
          title="Mean score"
          rows={chartRows}
          valueKey="meanScore"
          format={(n) => n.toFixed(2)}
        />
        <MetricBarChart
          title="Mean cost (USD)"
          rows={chartRows}
          valueKey="meanCost"
          format={formatUsd}
        />
        <MetricBarChart
          title="Cost per correct"
          rows={chartRows}
          valueKey="costPerCorrect"
          format={formatUsd}
        />
        <MetricBarChart
          title="Mean latency (ms)"
          rows={chartRows}
          valueKey="meanLatencyMs"
          format={(n) => `${Math.round(n)}`}
        />
      </div>
    </div>
  );
}

function DocBlock({ doc }: { doc: EvalDoc }) {
  return (
    <div
      className="space-y-2 rounded-xl border p-3"
      data-testid={`evals-doc-${doc.name}`}
    >
      <p className="text-sm font-medium capitalize">{doc.name} eval</p>
      {doc.markdown ? (
        <pre className="bg-muted/40 max-h-64 overflow-auto rounded-lg p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
          {doc.markdown.slice(0, 8000)}
        </pre>
      ) : null}
      {doc.json != null ? (
        <pre className="bg-muted/40 max-h-48 overflow-auto rounded-lg p-3 text-[11px] leading-relaxed">
          {JSON.stringify(doc.json, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export function EvaluationsPanel() {
  const [data, setData] = React.useState<EvalsApiResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/evals")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load evaluations");
        return (await res.json()) as EvalsApiResponse;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>;
  }
  if (!data) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  return (
    <div className="space-y-6" data-testid="evaluations-panel">
      <p className="text-muted-foreground text-xs">
        Local results from <code className="text-[11px]">evals/results/</code>.
        No network calls beyond this app.
        {data.benchSource ? (
          <>
            {" "}
            Showing{" "}
            <Badge variant="outline" className="align-middle text-[10px]">
              {data.benchSource}
            </Badge>
            {data.benchPath ? (
              <span className="text-muted-foreground">
                {" "}
                · {data.benchPath.split(/[/\\]/).pop()}
              </span>
            ) : null}
          </>
        ) : null}
      </p>

      {data.bench ? (
        <BenchTables report={data.bench} />
      ) : (
        <p className="text-muted-foreground text-sm">
          No bench JSON found. Run <code>pnpm bench</code> or rely on the
          shipped fixture.
        </p>
      )}

      {data.fixture && data.benchSource === "dated" ? (
        <details className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Sample fixture
          </summary>
          <div className="mt-3">
            <BenchTables report={data.fixture} />
          </div>
        </details>
      ) : null}

      {data.docs.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Default-model evals</p>
          {data.docs.map((doc) => (
            <DocBlock key={doc.name} doc={doc} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
