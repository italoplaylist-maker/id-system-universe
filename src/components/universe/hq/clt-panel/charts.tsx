"use client";

import { useId, useState } from "react";
import { Table2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { axisTicks, dayLabel, niceMax } from "@/lib/clt-dashboard";

/**
 * Gráficos do painel da equipe, em SVG puro (sem biblioteca), seguindo o método de visualização de dados:
 * barras de no máximo 24 px com ponta de dado arredondada (4 px) e base reta; 2 px de superfície entre segmentos;
 * grade de 1 px recessiva; texto sempre em tinta neutra (a cor identifica só a marca); legenda para 2+ séries;
 * dica ao passar o mouse E ao focar pelo teclado; visão em tabela para quem não enxerga cores.
 * Cores de série validadas (escuro, superfície #14171f, todos os pares): azul, laranja, água.
 */
export const SERIES = { blue: "#3987e5", orange: "#d95926", aqua: "#199e70" } as const;
/** Status reservados: nunca viram "série". Sempre com ícone e rótulo ao lado. */
export const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" } as const;

const SURFACE = "#14171f";
const GRID = "#262b36";
const AXIS = "#3a4150";
const MUTED = "#8890a3";

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

/** Retângulo com os dois cantos de cima arredondados (a ponta do dado); a base fica reta, ancorada no eixo. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function ChartCard({ title, subtitle, legend, actions, children }: { title: string; subtitle?: string; legend?: Array<{ label: string; color: string }>; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface-raised p-4" aria-label={title}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {legend && legend.length > 1 && (
            <ul className="flex flex-wrap gap-3 text-xs text-muted" aria-label="Legenda">
              {legend.map((l) => (
                <li key={l.label} className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: l.color }} aria-hidden />
                  {l.label}
                </li>
              ))}
            </ul>
          )}
          {actions}
        </div>
      </header>
      {children}
    </section>
  );
}

export function TableToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cn("flex items-center gap-1 rounded px-1.5 py-1 text-[11px]", on ? "bg-accent/20 text-foreground" : "text-muted hover:text-foreground")}>
      <Table2 className="h-3 w-3" aria-hidden />
      Tabela
    </button>
  );
}

/** Barras por dia: uma série (azul) ou empilhadas (até 3 séries). */
export function DayBarChart({
  title,
  subtitle,
  days,
  series,
  format = (n: number) => String(n),
  height = 190,
  emptyText = "Sem dados neste período.",
}: {
  title: string;
  subtitle?: string;
  days: string[];
  series: Series[];
  format?: (n: number) => string;
  height?: number;
  emptyText?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const uid = useId();
  const W = 640;
  const m = { l: 46, r: 8, t: 10, b: 24 };
  const plotW = W - m.l - m.r;
  const plotH = height - m.t - m.b;
  const n = days.length;
  const band = plotW / Math.max(n, 1);
  const barW = Math.min(24, band * 0.62);
  const totals = days.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const max = Math.max(...totals, 0);
  const top = niceMax(max);
  const y = (v: number) => m.t + plotH * (1 - v / top);
  const ticks = axisTicks(max, 4);
  const empty = max === 0;
  const GAP = 2;

  return (
    <ChartCard title={title} subtitle={subtitle} legend={series.map((s) => ({ label: s.label, color: s.color }))} actions={<TableToggle on={asTable} onClick={() => setAsTable((v) => !v)} />}>
      {asTable ? (
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-xs tabular-nums">
            <caption className="sr-only">{title}</caption>
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th className="px-2 py-1 text-left font-normal">Dia</th>
                {series.map((s) => <th key={s.key} className="px-2 py-1 text-right font-normal">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d} className="border-b border-border/50 last:border-0">
                  <td className="px-2 py-1 text-foreground">{dayLabel(d)}</td>
                  {series.map((s) => <td key={s.key} className="px-2 py-1 text-right text-foreground">{format(s.values[i] ?? 0)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={`${title}. Máximo ${format(max)} em um dia.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} />
                <text x={m.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill={MUTED} className="tabular-nums">{format(t)}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const cx = m.l + band * i + band / 2;
              const every = n > 10 ? 2 : 1;
              return (
                <g key={d}>
                  {i % every === (n - 1) % every && <text x={cx} y={height - 6} textAnchor="middle" fontSize={10.5} fill={MUTED}>{dayLabel(d)}</text>}
                  {(() => {
                    let acc = 0;
                    const visible = series.filter((s) => (s.values[i] ?? 0) > 0);
                    return visible.map((s, k) => {
                      const v = s.values[i] ?? 0;
                      const y1 = y(acc + v);
                      const y0 = y(acc);
                      acc += v;
                      const h = Math.max(0, y0 - y1 - (k > 0 ? GAP : 0));
                      if (h <= 0) return null;
                      const isTop = k === visible.length - 1;
                      const x = cx - barW / 2;
                      const yy = y1;
                      return (
                        <path
                          key={s.key}
                          d={isTop ? roundedTop(x, yy, barW, h, 4) : `M${x},${yy} h${barW} v${h} h${-barW} Z`}
                          fill={s.color}
                          opacity={hover === null || hover === i ? 1 : 0.55}
                        />
                      );
                    });
                  })()}
                  {/* alvo de passagem: coluna inteira, bem maior que a barra */}
                  <rect
                    x={m.l + band * i}
                    y={m.t}
                    width={band}
                    height={plotH + m.b}
                    fill="transparent"
                    tabIndex={0}
                    role="img"
                    aria-label={`${dayLabel(d)}: ${series.map((s) => `${s.label} ${format(s.values[i] ?? 0)}`).join(", ")}`}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    style={{ outline: "none" }}
                  />
                </g>
              );
            })}
            {hover !== null && <rect x={m.l + band * hover + 1} y={m.t} width={band - 2} height={plotH} fill="none" stroke={AXIS} strokeWidth={1} rx={4} pointerEvents="none" />}
          </svg>
          {empty && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted">{emptyText}</p>}
          {hover !== null && (
            <div
              id={`${uid}-tip`}
              role="tooltip"
              className="pointer-events-none absolute z-10 min-w-[8.5rem] rounded-lg border border-border bg-background/95 px-2.5 py-2 text-xs shadow-xl"
              style={{ left: `${((m.l + band * hover + band / 2) / W) * 100}%`, top: 0, transform: `translate(${hover > n / 2 ? "-105%" : "5%"}, 0)` }}
            >
              <p className="mb-1 text-muted">{dayLabel(days[hover])}</p>
              {series.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-muted">
                    <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} aria-hidden />
                    {s.label}
                  </span>
                  <strong className="tabular-nums text-foreground">{format(s.values[hover] ?? 0)}</strong>
                </p>
              ))}
              {series.length > 1 && <p className="mt-1 flex justify-between gap-3 border-t border-border pt-1 text-muted"><span>Total</span><strong className="tabular-nums text-foreground">{format(totals[hover])}</strong></p>}
            </div>
          )}
        </div>
      )}
    </ChartCard>
  );
}

/** Barras horizontais ordenadas (ranking): uma cor, valor na ponta, nome em tinta neutra. */
export function RankBars({ title, subtitle, items, unit = "", emptyText = "Nada a mostrar neste período." }: { title: string; subtitle?: string; items: Array<{ name: string; value: number }>; unit?: string; emptyText?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">{emptyText}</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((it, i) => (
            <li
              key={it.name}
              tabIndex={0}
              className="rounded outline-none focus-visible:ring-1 focus-visible:ring-accent"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${it.name}: ${it.value}${unit}`}
            >
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-foreground" title={it.name}>{it.name}</span>
                <strong className="tabular-nums text-foreground">{it.value.toLocaleString("pt-BR")}{unit}</strong>
              </div>
              <div className="h-2 rounded-full" style={{ background: GRID }} aria-hidden>
                <div className="h-2 rounded-full transition-[width,opacity]" style={{ width: `${Math.max(3, (it.value / max) * 100)}%`, background: SERIES.blue, opacity: hover === null || hover === i ? 1 : 0.5 }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

/** Medidor: o preenchimento carrega a gravidade (azul → aviso → crítico); a trilha é um tom mais claro da mesma rampa. */
export function Meter({ percent, label }: { percent: number | null; label: string }) {
  const p = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const color = percent === null ? SERIES.blue : percent >= 100 ? STATUS.critical : percent >= 80 ? STATUS.warning : SERIES.blue;
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-label={label}>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: "#1c3454" }}>
        <div className="h-2 rounded-full transition-[width]" style={{ width: `${p}%`, background: color }} />
      </div>
      <p className="mt-1 text-[11px] text-muted">
        {percent === null ? "sem limite definido" : `${percent}% do limite`}
        {percent !== null && percent >= 100 ? " · limite atingido" : percent !== null && percent >= 80 ? " · atenção" : ""}
      </p>
    </div>
  );
}

export function StatTile({ label, value, hint, children }: { label: string; value: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold leading-none text-foreground tabular-nums">{value}</p>
      {hint && <p className="mt-1.5 text-[11px] text-muted">{hint}</p>}
      {children && <div className="mt-2.5">{children}</div>}
    </div>
  );
}

export const SURFACE_COLOR = SURFACE;
