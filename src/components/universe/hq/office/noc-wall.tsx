"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
import { PALETTE } from "../palette";
import { OFFICE, type OfficeLayout } from "./office-layout";
import { formatMb, formatRate, formatUptime } from "@/lib/format-metrics";
import type { ServerOverview } from "@/server/monitoring/server-service";

const SW = 1024;
const SH = 640;
const SCREEN_W = 2.1;
const SCREEN_H = (SCREEN_W * SH) / SW;
const GAP = 0.2;
const HEADER = { cw: 2048, ch: 128, w: 3 * SCREEN_W + 2 * GAP, h: ((3 * SCREEN_W + 2 * GAP) * 128) / 2048 };

const INK = "#e6e9f0";
const MUTED = "#8b96ad";
const OK = "#34d399";
const WARN = "#fbbf24";
const BAD = "#f87171";
const LEVEL_COLOR = { ok: "#38bdf8", warning: WARN, critical: BAD } as const;
const FONT = "ui-sans-serif, system-ui";

function bg(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#0b101b");
  g.addColorStop(1, "#070a11");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function title(ctx: CanvasRenderingContext2D, text: string, right?: string) {
  ctx.textAlign = "left";
  ctx.fillStyle = MUTED;
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText(text, 36, 52);
  if (right) {
    ctx.textAlign = "right";
    ctx.fillText(right, SW - 36, 52);
  }
  ctx.fillStyle = "#1f2733";
  ctx.fillRect(36, 70, SW - 72, 2);
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, percent: number, color: string) {
  ctx.fillStyle = "#1a2230";
  ctx.fillRect(x, y, w, 12);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.max(2, (w * Math.min(100, percent)) / 100), 12);
}

function worst(s: ServerOverview): "ok" | "warning" | "critical" {
  const l = [s.levels.cpu, s.levels.mem, s.levels.disk];
  return l.includes("critical") ? "critical" : l.includes("warning") ? "warning" : "ok";
}

function empty(ctx: CanvasRenderingContext2D, line1: string, line2: string) {
  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  ctx.font = `700 38px ${FONT}`;
  ctx.fillText(line1, SW / 2, SH / 2 - 8);
  ctx.fillStyle = MUTED;
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(line2, SW / 2, SH / 2 + 36);
}

/** Tela 1 — visão geral da frota. */
function paintFleet(ctx: CanvasRenderingContext2D, servers: ServerOverview[]) {
  bg(ctx, SW, SH);
  title(ctx, "SERVIDORES", `${servers.filter((s) => s.status === "ONLINE").length}/${servers.length} ONLINE`);
  if (servers.length === 0) return empty(ctx, "Nenhum servidor monitorado", "Instale o agente em /servers");
  const rowH = Math.min(100, (SH - 110) / Math.min(servers.length, 5));
  servers.slice(0, 5).forEach((s, i) => {
    const y = 96 + i * rowH;
    const online = s.status === "ONLINE";
    ctx.fillStyle = online ? OK : s.status === "OFFLINE" ? BAD : MUTED;
    ctx.beginPath();
    ctx.arc(52, y + 18, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = INK;
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(s.name.length > 18 ? `${s.name.slice(0, 17)}…` : s.name, 76, y + 28);
    ctx.fillStyle = s.status === "OFFLINE" ? BAD : MUTED;
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(s.status === "ONLINE" ? "ONLINE" : s.status === "OFFLINE" ? "OFFLINE" : "AGUARDANDO AGENTE", 76, y + 52);
    if (s.latest && online) {
      const cols = [
        { l: "CPU", v: s.latest.cpuPercent, c: LEVEL_COLOR[s.levels.cpu] },
        { l: "MEM", v: s.latest.mem.percent, c: LEVEL_COLOR[s.levels.mem] },
        { l: "DISCO", v: s.latest.disk.percent, c: LEVEL_COLOR[s.levels.disk] },
      ];
      cols.forEach((c, k) => {
        const x = 440 + k * 190;
        ctx.textAlign = "left";
        ctx.fillStyle = MUTED;
        ctx.font = `600 18px ${FONT}`;
        ctx.fillText(c.l, x, y + 18);
        ctx.fillStyle = c.c;
        ctx.font = `800 30px ${FONT}`;
        ctx.fillText(`${Math.round(c.v)}%`, x, y + 50);
        bar(ctx, x, y + 60, 150, c.v, c.c);
      });
    }
  });
}

function spark(ctx: CanvasRenderingContext2D, values: number[], x: number, y: number, w: number, h: number, color: string) {
  ctx.strokeStyle = "#1f2733";
  ctx.lineWidth = 1;
  for (const f of [0, 0.5, 1]) {
    ctx.beginPath();
    ctx.moveTo(x, y + h * f);
    ctx.lineTo(x + w, y + h * f);
    ctx.stroke();
  }
  if (values.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.beginPath();
  values.forEach((v, i) => {
    const px = x + (i / (values.length - 1)) * w;
    const py = y + h - (Math.min(100, v) / 100) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
}

/** Tela 2 — CPU e memória da última hora do servidor principal. */
function paintLoad(ctx: CanvasRenderingContext2D, main: ServerOverview | null) {
  bg(ctx, SW, SH);
  title(ctx, "CPU · MEMÓRIA — ÚLTIMA HORA", main?.name.toUpperCase());
  if (!main?.latest || main.status !== "ONLINE") return empty(ctx, main ? "Sem sinal do agente" : "Sem servidor", main ? "Aguardando métricas…" : "Adicione uma VPS em /servers");
  const l = main.latest;
  const blocks = [
    { label: "CPU", value: l.cpuPercent, level: main.levels.cpu, series: main.spark.cpu, y: 96 },
    { label: "MEMÓRIA", value: l.mem.percent, level: main.levels.mem, series: main.spark.mem, y: 96 + 252 },
  ];
  for (const b of blocks) {
    const color = LEVEL_COLOR[b.level];
    ctx.textAlign = "left";
    ctx.fillStyle = MUTED;
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText(b.label, 36, b.y + 24);
    ctx.fillStyle = color;
    ctx.font = `800 64px ${FONT}`;
    ctx.fillText(`${b.value.toFixed(0)}%`, 36, b.y + 96);
    spark(ctx, b.series, 250, b.y + 6, SW - 250 - 40, 190, "#38bdf8");
  }
}

/** Tela 3 — rede, disco, uptime e containers mais pesados. */
function paintDetail(ctx: CanvasRenderingContext2D, main: ServerOverview | null) {
  bg(ctx, SW, SH);
  title(ctx, "REDE · DISCO · CONTAINERS", main?.name.toUpperCase());
  if (!main?.latest || main.status !== "ONLINE") return empty(ctx, main ? "Sem sinal do agente" : "Sem servidor", main ? "Aguardando métricas…" : "Adicione uma VPS em /servers");
  const l = main.latest;
  const facts = [
    { l: "REDE ↓", v: formatRate(l.netRxBps) },
    { l: "REDE ↑", v: formatRate(l.netTxBps) },
    { l: "DISCO USADO", v: `${l.disk.percent.toFixed(0)}% · ${formatMb(l.disk.usedMb)}` },
    { l: "UPTIME", v: formatUptime(l.uptimeSec) },
  ];
  facts.forEach((f, i) => {
    const x = 36 + (i % 2) * 480;
    const y = 100 + Math.floor(i / 2) * 92;
    ctx.textAlign = "left";
    ctx.fillStyle = MUTED;
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(f.l, x, y + 20);
    ctx.fillStyle = INK;
    ctx.font = `800 36px ${FONT}`;
    ctx.fillText(f.v, x, y + 62);
  });
  ctx.fillStyle = "#1f2733";
  ctx.fillRect(36, 292, SW - 72, 2);
  ctx.fillStyle = MUTED;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(`CONTAINERS  ${l.containersRunning}/${l.containersTotal}`, 36, 328);
  const top = main.containers.slice(0, 5);
  if (top.length === 0) {
    ctx.fillStyle = MUTED;
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText("Docker não reportado", 36, 376);
  }
  top.forEach((c, i) => {
    const y = 372 + i * 48;
    ctx.fillStyle = INK;
    ctx.font = `600 24px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(c.name.length > 30 ? `${c.name.slice(0, 29)}…` : c.name, 36, y);
    ctx.textAlign = "right";
    ctx.fillStyle = MUTED;
    ctx.fillText(`${c.cpuPercent.toFixed(1)}% CPU`, SW - 230, y);
    ctx.fillText(formatMb(c.memMb), SW - 36, y);
  });
}

function paintHeader(ctx: CanvasRenderingContext2D, servers: ServerOverview[]) {
  const { cw, ch } = HEADER;
  bg(ctx, cw, ch);
  const critical = servers.filter((s) => s.status === "OFFLINE" || worst(s) === "critical").length;
  const warning = servers.filter((s) => s.status === "ONLINE" && worst(s) === "warning").length;
  ctx.textAlign = "left";
  ctx.fillStyle = "#38bdf8";
  ctx.font = `800 54px ${FONT}`;
  ctx.fillText("NOC · INFRAESTRUTURA", 48, 82);
  ctx.fillStyle = PALETTE.brand;
  ctx.fillRect(48, 98, 110, 6);
  const text = servers.length === 0 ? "SEM SERVIDORES" : critical > 0 ? `${critical} CRÍTICO(S)` : warning > 0 ? `${warning} EM ATENÇÃO` : "TUDO NORMAL";
  const color = servers.length === 0 ? MUTED : critical > 0 ? BAD : warning > 0 ? WARN : OK;
  ctx.textAlign = "right";
  ctx.fillStyle = color;
  ctx.font = `800 48px ${FONT}`;
  ctx.fillText(text, cw - 48, 82);
  const w = ctx.measureText(text).width;
  ctx.beginPath();
  ctx.arc(cw - 48 - w - 30, 66, 13, 0, Math.PI * 2);
  ctx.fill();
}

type Painter = (ctx: CanvasRenderingContext2D) => void;

/** Tela viva: textura em canvas, repintada só quando a chave dos dados muda (mesmo padrão do telão). */
function LiveScreen({ cw, ch, width, height, paint, dataKey, position }: { cw: number; ch: number; width: number; height: number; paint: Painter; dataKey: string; position: [number, number, number] }) {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    textureRef.current = texture;
    if (materialRef.current) {
      materialRef.current.map = texture;
      materialRef.current.needsUpdate = true;
    }
    return () => texture.dispose();
  }, [cw, ch]);

  useEffect(() => {
    const texture = textureRef.current;
    if (!texture) return;
    const ctx = (texture.image as HTMLCanvasElement).getContext("2d");
    if (!ctx) return;
    paint(ctx);
    texture.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repaint only when the displayed data changes
  }, [dataKey]);

  return (
    <group position={position}>
      <RoundedBox args={[width + 0.1, height + 0.1, 0.08]} radius={0.03} smoothness={3}>
        <meshStandardMaterial color="#0b0d12" metalness={0.5} roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 0, 0.042]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial ref={materialRef} toneMapped={false} />
      </mesh>
    </group>
  );
}

function keyOf(servers: ServerOverview[]): string {
  return servers
    .map((s) => `${s.id}:${s.status}:${s.latest ? `${s.latest.cpuPercent.toFixed(0)},${s.latest.mem.percent.toFixed(0)},${s.latest.disk.percent.toFixed(0)},${s.latest.netRxBps.toFixed(0)},${s.latest.netTxBps.toFixed(0)},${s.latest.uptimeSec}` : "-"}:${s.spark.cpu.length}:${s.containers.map((c) => c.name + c.cpuPercent).join("|")}`)
    .join(";");
}

/**
 * Parede do NOC na parede oeste: cabeçalho de estado + 3 telas com dados reais dos agentes.
 * Clicar em qualquer ponto abre a página /servers.
 */
export function NocWall({ layout, servers, onOpen }: { layout: OfficeLayout; servers: ServerOverview[]; onOpen: () => void }) {
  const { width } = layout;
  const T = OFFICE.WALL_THICKNESS;
  const zc = (layout.noc.z0 + layout.noc.z1) / 2;
  const x = -width / 2 + T / 2 + 0.07;
  const main = servers.find((s) => s.status === "ONLINE") ?? servers[0] ?? null;
  const k = keyOf(servers);
  const screenY = 1.75;
  const step = SCREEN_W + GAP;

  return (
    <group
      position={[x, 0, zc]}
      rotation={[0, Math.PI / 2, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    >
      {/* painel de fundo: cobre a janela neste trecho */}
      <mesh position={[0, 2.15, -0.03]}>
        <boxGeometry args={[layout.noc.length, 2.5, 0.06]} />
        <meshStandardMaterial color="#141a26" roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh position={[0, 3.36, 0.01]}>
        <boxGeometry args={[layout.noc.length, 0.04, 0.05]} />
        <meshStandardMaterial color={PALETTE.brand} emissive={PALETTE.brand} emissiveIntensity={0.9} />
      </mesh>
      <LiveScreen cw={HEADER.cw} ch={HEADER.ch} width={HEADER.w} height={HEADER.h} paint={(ctx) => paintHeader(ctx, servers)} dataKey={k} position={[0, 2.88, 0.06]} />
      <LiveScreen cw={SW} ch={SH} width={SCREEN_W} height={SCREEN_H} paint={(ctx) => paintFleet(ctx, servers)} dataKey={k} position={[-step, screenY, 0.06]} />
      <LiveScreen cw={SW} ch={SH} width={SCREEN_W} height={SCREEN_H} paint={(ctx) => paintLoad(ctx, main)} dataKey={k} position={[0, screenY, 0.06]} />
      <LiveScreen cw={SW} ch={SH} width={SCREEN_W} height={SCREEN_H} paint={(ctx) => paintDetail(ctx, main)} dataKey={k} position={[step, screenY, 0.06]} />
    </group>
  );
}
