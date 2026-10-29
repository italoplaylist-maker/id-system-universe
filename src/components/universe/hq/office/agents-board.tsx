"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
import { PALETTE } from "../palette";
import { SCREEN_CANVAS, type OfficeLayout } from "./office-layout";

export interface AgentsBoardStats {
  active: number;
  working: number;
  idle: number;
  errors: number;
  tools: number;
}

const { width: CW, height: CH } = SCREEN_CANVAS;

function paint(ctx: CanvasRenderingContext2D, stats: AgentsBoardStats) {
  const g = ctx.createLinearGradient(0, 0, 0, CH);
  g.addColorStop(0, "#0b101b");
  g.addColorStop(1, "#070a11");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CW, CH);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "#38bdf8";
  ctx.font = "700 40px ui-sans-serif, system-ui";
  ctx.fillText("CENTRAL DE AGENTES CLAUDE", 64, 68);
  ctx.fillStyle = PALETTE.brand;
  ctx.fillRect(64, 84, 96, 5);

  const bad = stats.errors > 0;
  const text = stats.active === 0 ? "NENHUM AGENTE ATIVO" : bad ? "FALHA DE FERRAMENTA" : stats.working > 0 ? "AGENTES TRABALHANDO" : "AGENTES AGUARDANDO";
  const color = stats.active === 0 ? "#8b96ad" : bad ? "#f87171" : stats.working > 0 ? "#38bdf8" : "#34d399";
  ctx.textAlign = "right";
  ctx.fillStyle = color;
  ctx.font = "700 30px ui-sans-serif, system-ui";
  ctx.fillText(text, CW - 64, 66);

  const cols = [
    { label: "ATIVOS", value: stats.active, color: "#e6e9f0" },
    { label: "TRABALHANDO", value: stats.working, color: "#38bdf8" },
    { label: "AGUARDANDO", value: stats.idle, color: "#e6e9f0" },
    { label: "COM ERRO", value: stats.errors, color: stats.errors > 0 ? "#f87171" : "#e6e9f0" },
    { label: "FERRAMENTAS", value: stats.tools, color: "#e6e9f0" },
  ];
  const pad = 64;
  const colWidth = (CW - pad * 2) / cols.length;
  ctx.textAlign = "center";
  cols.forEach((c, i) => {
    const cx = pad + colWidth * i + colWidth / 2;
    ctx.fillStyle = c.color;
    ctx.font = "800 112px ui-sans-serif, system-ui";
    ctx.fillText(String(c.value), cx, 235);
    ctx.fillStyle = "#8b96ad";
    ctx.font = "600 26px ui-sans-serif, system-ui";
    ctx.fillText(c.label, cx, 275);
    ctx.fillStyle = c.color;
    ctx.fillRect(cx - 34, 292, 68, 4);
  });
}

/** Telão da sala de agentes — mesmo desenho e proporção exata do telão do escritório dos projetos. */
export function AgentsBoard({ layout, stats }: { layout: OfficeLayout; stats: AgentsBoardStats }) {
  const { width, height, y, z } = layout.screen;
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = CW;
    canvas.height = CH;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    textureRef.current = texture;
    if (materialRef.current) {
      materialRef.current.map = texture;
      materialRef.current.needsUpdate = true;
    }
    return () => texture.dispose();
  }, []);

  const key = `${stats.active}|${stats.working}|${stats.idle}|${stats.errors}|${stats.tools}`;
  useEffect(() => {
    const texture = textureRef.current;
    if (!texture) return;
    const ctx = (texture.image as HTMLCanvasElement).getContext("2d");
    if (!ctx) return;
    paint(ctx, stats);
    texture.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repaint only when the displayed numbers change
  }, [key]);

  return (
    <group position={[0, y, z + 0.06]}>
      <RoundedBox args={[width + 0.22, height + 0.22, 0.12]} radius={0.05} smoothness={3} castShadow>
        <meshStandardMaterial color="#0b0d12" metalness={0.5} roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 0, 0.062]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial ref={materialRef} toneMapped={false} />
      </mesh>
    </group>
  );
}
