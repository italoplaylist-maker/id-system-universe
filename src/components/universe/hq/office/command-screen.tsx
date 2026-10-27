"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
import { PALETTE } from "../palette";
import { SCREEN_CANVAS, type OfficeLayout } from "./office-layout";

export interface CommandCenterStats {
  projectCount: number;
  resourceCount: number;
  onlineCount: number;
  deployingCount: number;
  incidentCount: number;
  employeeCount: number;
  /** Só contagens agregadas, e só para quem tem permissão financeira. */
  billing?: { pending: number; overdue: number; dueToday: number } | null;
}

const { width: CW, height: CH } = SCREEN_CANVAS;

function paintScreen(ctx: CanvasRenderingContext2D, stats: CommandCenterStats) {
  const g = ctx.createLinearGradient(0, 0, 0, CH);
  g.addColorStop(0, "#0b101b");
  g.addColorStop(1, "#070a11");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CW, CH);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "#38bdf8";
  ctx.font = "700 40px ui-sans-serif, system-ui";
  ctx.fillText("ID SYSTEM UNIVERSE", 64, 68);
  ctx.fillStyle = PALETTE.brand;
  ctx.fillRect(64, 84, 96, 5);

  const ok = stats.incidentCount === 0;
  ctx.textAlign = "right";
  ctx.fillStyle = ok ? "#34d399" : "#f87171";
  ctx.font = "700 30px ui-sans-serif, system-ui";
  ctx.fillText(ok ? "OPERAÇÃO NORMAL" : "ATENÇÃO NECESSÁRIA", CW - 64, 66);
  ctx.beginPath();
  ctx.arc(CW - 64 - ctx.measureText(ok ? "OPERAÇÃO NORMAL" : "ATENÇÃO NECESSÁRIA").width - 28, 55, 10, 0, Math.PI * 2);
  ctx.fill();

  const cols: { label: string; value: number; color: string }[] = [
    { label: "PROJETOS", value: stats.projectCount, color: "#e6e9f0" },
    { label: "RECURSOS", value: stats.resourceCount, color: "#e6e9f0" },
    { label: "ONLINE", value: stats.onlineCount, color: "#34d399" },
    { label: "FUNCIONÁRIOS", value: stats.employeeCount, color: "#e6e9f0" },
    { label: "IMPLANTANDO", value: stats.deployingCount, color: "#38bdf8" },
    { label: "ALERTAS", value: stats.incidentCount, color: stats.incidentCount > 0 ? "#f87171" : "#e6e9f0" },
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

  if (stats.billing) {
    const { pending, overdue, dueToday } = stats.billing;
    ctx.textAlign = "center";
    ctx.fillStyle = "#6f7a90";
    ctx.font = "600 24px ui-sans-serif, system-ui";
    ctx.fillText(
      `COBRANÇAS  ·  ${pending} PENDENTES  ·  ${dueToday} VENCEM HOJE  ·  ${overdue} VENCIDAS`,
      CW / 2,
      366,
    );
  }
}

/**
 * The Central de Comando screen: a CanvasTexture on a real mesh whose plane has EXACTLY the
 * canvas aspect ratio (height derives from width × canvasH/canvasW), so nothing is ever
 * stretched. Repainted only when the displayed numbers change.
 */
export function CommandScreen({ layout, stats }: { layout: OfficeLayout; stats: CommandCenterStats }) {
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

  const key = `${stats.projectCount}|${stats.resourceCount}|${stats.onlineCount}|${stats.deployingCount}|${stats.incidentCount}|${stats.employeeCount}|${stats.billing ? `${stats.billing.pending},${stats.billing.overdue},${stats.billing.dueToday}` : "-"}`;
  useEffect(() => {
    const texture = textureRef.current;
    if (!texture) return;
    const ctx = (texture.image as HTMLCanvasElement).getContext("2d");
    if (!ctx) return;
    paintScreen(ctx, stats);
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
      {/* soft red underglow along the bottom edge */}
      <mesh position={[0, -height / 2 - 0.14, 0.02]}>
        <boxGeometry args={[width * 0.6, 0.025, 0.03]} />
        <meshStandardMaterial color={PALETTE.brand} emissive={PALETTE.brand} emissiveIntensity={1.1} />
      </mesh>
    </group>
  );
}
