"use client";

import { useId, useMemo, useState } from "react";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  values: Array<number | null>;
}

interface LineChartProps {
  title: string;
  times: string[];
  series: ChartSeries[];
  /** Eixo Y: 0–100 (percentual) ou automático a partir de 0. */
  yMax?: number;
  format: (value: number) => string;
  /** Linhas de referência (ex.: limiar crítico), desenhadas tracejadas. */
  thresholds?: Array<{ value: number; label: string }>;
  height?: number;
  emptyText?: string;
}

const W = 640;
const PAD = { l: 58, r: 12, t: 10, b: 22 };

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(max));
  const f = max / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/** Linha fina (2px), um eixo, grade discreta, crosshair + tooltip no hover. Legenda sempre que há ≥2 séries. */
export function LineChart({ title, times, series, yMax, format, thresholds = [], height = 168, emptyText = "Sem dados no período." }: LineChartProps) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const max = useMemo(() => {
    if (yMax) return yMax;
    const peak = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
    return niceMax(peak * 1.1);
  }, [series, yMax]);

  const n = times.length;
  const plotW = W - PAD.l - PAD.r;
  const plotH = height - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.t + plotH - (Math.min(v, max) / max) * plotH;

  const paths = series.map((s) => {
    let d = "";
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  });

  const ticks = [0, 0.5, 1].map((f) => f * max);
  const timeLabel = (iso: string, long = false) => {
    const d = new Date(iso);
    const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return long ? `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hm}` : hm;
  };
  const rangeMs = n > 1 ? new Date(times[n - 1]).getTime() - new Date(times[0]).getTime() : 0;
  const showDate = rangeMs > 24 * 3600_000;

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[11px] uppercase tracking-wider text-muted">{title}</h3>
        <div className="flex items-center gap-3">
          {series.length >= 2 && (
            <ul className="flex items-center gap-3 text-xs text-foreground">
              {series.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                  {s.label}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setTable((t) => !t)} className="text-[11px] text-muted underline-offset-2 hover:text-foreground hover:underline">
            {table ? "Ver gráfico" : "Ver tabela"}
          </button>
        </div>
      </div>

      {n === 0 ? (
        <div className="flex items-center justify-center rounded-md border border-dashed border-border text-xs text-muted" style={{ height }}>
          {emptyText}
        </div>
      ) : table ? (
        <div className="overflow-auto rounded-md border border-border text-xs" style={{ maxHeight: height }}>
          <table className="w-full tabular-nums">
            <thead className="sticky top-0 bg-surface-raised text-muted">
              <tr>
                <th className="px-2 py-1 text-left font-normal">Horário</th>
                {series.map((s) => (
                  <th key={s.key} className="px-2 py-1 text-right font-normal">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map((t, i) => (
                <tr key={t} className="border-t border-border">
                  <td className="px-2 py-1 text-muted">{timeLabel(t, true)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-2 py-1 text-right text-foreground">{s.values[i] === null ? "—" : format(s.values[i] as number)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${height}`}
            className="block w-full touch-none select-none"
            role="img"
            aria-labelledby={`${id}-t`}
            onPointerMove={handleMove}
            onPointerLeave={() => setHover(null)}
          >
            <title id={`${id}-t`}>{title}</title>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
                <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">{format(t)}</text>
              </g>
            ))}
            {thresholds.filter((th) => th.value <= max).map((th) => (
              <g key={th.label}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(th.value)} y2={y(th.value)} stroke="var(--status-error)" strokeWidth={1} strokeDasharray="4 4" opacity={0.55} />
                <text x={W - PAD.r - 2} y={y(th.value) - 3} textAnchor="end" fontSize={9} fill="var(--muted)">{th.label}</text>
              </g>
            ))}
            <text x={PAD.l} y={height - 6} fontSize={10} fill="var(--muted)">{timeLabel(times[0], showDate)}</text>
            <text x={W - PAD.r} y={height - 6} fontSize={10} textAnchor="end" fill="var(--muted)">{timeLabel(times[n - 1], showDate)}</text>
            {paths.map((d, i) => (
              <path key={series[i].key} d={d} fill="none" stroke={series[i].color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {n === 1 && series.map((s) => s.values[0] !== null && <circle key={s.key} cx={x(0)} cy={y(s.values[0] as number)} r={3} fill={s.color} />)}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + plotH} stroke="var(--muted)" strokeWidth={1} opacity={0.6} />
                {series.map((s) => s.values[hover] !== null && (
                  <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] as number)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-1 z-10 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs shadow-xl"
              style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > n / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}
            >
              <p className="text-muted">{timeLabel(times[hover], true)}</p>
              {series.map((s) => (
                <p key={s.key} className="flex items-center gap-1.5 tabular-nums text-foreground">
                  <span aria-hidden className="inline-block h-0.5 w-2.5 rounded" style={{ background: s.color }} />
                  {series.length > 1 && <span className="text-muted">{s.label}</span>}
                  {s.values[hover] === null ? "—" : format(s.values[hover] as number)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
