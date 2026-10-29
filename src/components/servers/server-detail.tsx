"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatAgo, formatMb, formatRate, formatUptime } from "@/lib/format-metrics";
import { THRESHOLDS, type AlertLevel } from "@/server/monitoring/thresholds";
import { useServerMetrics, type RangeKey, type ServerOverview } from "@/hooks/use-servers";
import { LineChart } from "./line-chart";
import { InstallHint } from "./install-hint";

const RANGE_LABEL: Record<RangeKey, string> = { "1h": "1 hora", "6h": "6 horas", "24h": "24 horas", "7d": "7 dias" };

// Cores de série: não reutilizam as de status (reservadas para estado).
const C = { cpu: "#38bdf8", mem: "#a78bfa", disk: "#2dd4bf", load: "#f0abfc", rx: "#38bdf8", tx: "#fb923c", read: "#38bdf8", write: "#fb923c" };

const LEVEL_TEXT: Record<AlertLevel, string> = { ok: "text-foreground", warning: "text-status-warning", critical: "text-status-error" };
const LEVEL_ICON = { ok: null, warning: AlertTriangle, critical: XCircle } as const;
const LEVEL_LABEL: Record<AlertLevel, string> = { ok: "Normal", warning: "Atenção", critical: "Crítico" };

export function StatusPill({ status }: { status: ServerOverview["status"] }) {
  const map = {
    ONLINE: { label: "Online", cls: "text-status-running border-status-running/40 bg-status-running/10", Icon: CheckCircle2 },
    OFFLINE: { label: "Offline", cls: "text-status-error border-status-error/40 bg-status-error/10", Icon: XCircle },
    WAITING: { label: "Aguardando agente", cls: "text-muted border-border bg-surface-raised", Icon: CircleDashed },
  }[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", map.cls)}>
      <map.Icon className="h-3 w-3" aria-hidden />
      {map.label}
    </span>
  );
}

function Meter({ label, percent, level, detail }: { label: string; percent: number; level: AlertLevel; detail: string }) {
  const Icon = LEVEL_ICON[level];
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
        {Icon && (
          <span className={cn("flex items-center gap-1 text-[11px]", LEVEL_TEXT[level])}>
            <Icon className="h-3 w-3" aria-hidden />
            {LEVEL_LABEL[level]}
          </span>
        )}
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums", LEVEL_TEXT[level])}>{percent.toFixed(1)}%</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cn("h-full rounded-full", level === "critical" ? "bg-status-error" : level === "warning" ? "bg-status-warning" : "bg-accent")} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">{detail}</p>
    </Card>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

export function ServerDetail({ server }: { server: ServerOverview }) {
  const [range, setRange] = useState<RangeKey>("1h");
  const { data } = useServerMetrics(server.id, range);
  const l = server.latest;
  const points = data?.points ?? [];
  const times = points.map((p) => p.t);

  if (!l) return <InstallHint server={server} />;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Meter label="CPU" percent={l.cpuPercent} level={server.levels.cpu} detail={`${server.cpuCores ?? "?"} núcleos · load ${l.load[0].toFixed(2)} / ${l.load[1].toFixed(2)} / ${l.load[2].toFixed(2)}`} />
        <Meter label="Memória" percent={l.mem.percent} level={server.levels.mem} detail={`${formatMb(l.mem.usedMb)} de ${formatMb(l.mem.totalMb)}${l.swap.totalMb > 0 ? ` · swap ${formatMb(l.swap.usedMb)}` : ""}`} />
        <Meter label="Disco (/)" percent={l.disk.percent} level={server.levels.disk} detail={`${formatMb(l.disk.usedMb)} de ${formatMb(l.disk.totalMb)}`} />
        <Fact label="Uptime" value={formatUptime(l.uptimeSec)} sub={`${l.procs} processos · ${l.containersRunning}/${l.containersTotal} containers`} />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted">Histórico</h2>
        <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Período">
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((r) => (
            <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={cn("rounded px-3 py-1 text-xs", range === r ? "bg-accent text-black" : "text-muted hover:text-foreground")}>
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <LineChart title="CPU (%)" times={times} yMax={100} format={(v) => `${Math.round(v)}%`} thresholds={[{ value: THRESHOLDS.cpu.critical, label: "crítico" }]} series={[{ key: "cpu", label: "CPU", color: C.cpu, values: points.map((p) => p.cpu) }]} />
        </Card>
        <Card className="p-4">
          <LineChart title="Memória (%)" times={times} yMax={100} format={(v) => `${Math.round(v)}%`} thresholds={[{ value: THRESHOLDS.mem.critical, label: "crítico" }]} series={[{ key: "mem", label: "Memória", color: C.mem, values: points.map((p) => p.mem) }]} />
        </Card>
        <Card className="p-4">
          <LineChart title="Rede" times={times} format={formatRate} series={[{ key: "rx", label: "Entrada", color: C.rx, values: points.map((p) => p.netRx) }, { key: "tx", label: "Saída", color: C.tx, values: points.map((p) => p.netTx) }]} />
        </Card>
        <Card className="p-4">
          <LineChart title="Disco — I/O" times={times} format={formatRate} series={[{ key: "read", label: "Leitura", color: C.read, values: points.map((p) => p.diskRead) }, { key: "write", label: "Escrita", color: C.write, values: points.map((p) => p.diskWrite) }]} />
        </Card>
        <Card className="p-4">
          <LineChart title="Carga média (load 1 min)" times={times} format={(v) => v.toFixed(2)} series={[{ key: "load", label: "Load", color: C.load, values: points.map((p) => p.load1) }]} />
        </Card>
        <Card className="p-4">
          <LineChart title="Disco usado (%)" times={times} yMax={100} format={(v) => `${Math.round(v)}%`} thresholds={[{ value: THRESHOLDS.disk.critical, label: "crítico" }]} series={[{ key: "disk", label: "Disco", color: C.disk, values: points.map((p) => p.disk) }]} />
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-xs uppercase tracking-[0.2em] text-muted">Containers em execução</h2>
        {server.containers.length === 0 ? (
          <p className="text-sm text-muted">Nenhum container reportado (Docker ausente ou sem permissão para o agente).</p>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-left font-normal">Container</th>
                  <th className="px-4 py-2 text-right font-normal">CPU</th>
                  <th className="px-4 py-2 text-right font-normal">Memória</th>
                  <th className="px-4 py-2 text-right font-normal">% mem.</th>
                </tr>
              </thead>
              <tbody>
                {server.containers.map((c) => (
                  <tr key={c.name} className="border-b border-border last:border-0">
                    <td className="max-w-[260px] truncate px-4 py-2 text-foreground" title={c.name}>{c.name}</td>
                    <td className="px-4 py-2 text-right">{c.cpuPercent.toFixed(1)}%</td>
                    <td className="px-4 py-2 text-right">{formatMb(c.memMb)}</td>
                    <td className="px-4 py-2 text-right">{c.memPercent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <p className="text-xs text-muted">
        {server.hostname ?? "—"} · {server.os ?? "—"} · kernel {server.kernel ?? "—"} · {server.cpuModel ?? "—"} · agente v{server.agentVersion ?? "?"} · último sinal {formatAgo(server.lastSeenAt)}
      </p>
    </div>
  );
}
