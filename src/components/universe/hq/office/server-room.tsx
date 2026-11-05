"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { PALETTE } from "../palette";
import { MergeStatic } from "../render/merge-static";
import { useUiStore } from "@/store/ui-store";
import type { OfficeLayout } from "./office-layout";

const STEEL = "#8d95a3";

/** Retângulo (plano local da ala) ocupado pelos racks + folga; null se não há racks. */
export function serverRoomBounds(layout: OfficeLayout): { x0: number; x1: number; z0: number; z1: number } | null {
  if (layout.racks.length === 0) return null;
  const xs = layout.racks.map((r) => r.x);
  const zs = layout.racks.map((r) => r.z);
  return { x0: Math.min(...xs) - 0.85, x1: Math.max(...xs) + 0.85, z0: -layout.depth / 2 + 0.2, z1: Math.max(...zs) + 1.2 };
}

function sign(): THREE.MeshBasicMaterial {
  const c = document.createElement("canvas");
  c.width = 768;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e6e9f0";
  g.font = "700 46px ui-sans-serif, system-ui";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("SALA DE SERVIDORES", 384, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthWrite: false });
}

/**
 * Sala de servidores fechada: recinto de vidro escurecido em volta dos racks, com porta, perfis de aço e LED vermelho.
 * Só existe quando há racks (um por provedor real) — nada é desenhado para preencher cenário.
 */
export function ServerRoom({ layout }: { layout: OfficeLayout }) {
  const b = serverRoomBounds(layout);
  const quality = useUiStore((st) => st.quality);
  const signMat = useMemo(() => sign(), []);
  useEffect(
    () => () => {
      signMat.map?.dispose();
      signMat.dispose();
    },
    [signMat],
  );
  if (!b) return null;
  const H = 2.9;
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0;
  const doorW = 1.0;
  const doorX = b.x0 + w * 0.5;
  const glass = (
    <meshPhysicalMaterial color="#0c1118" transparent opacity={0.42} roughness={0.08} metalness={0.2} clearcoat={1} clearcoatRoughness={0.06} envMapIntensity={1.5} depthWrite={false} side={THREE.DoubleSide} />
  );
  const frame = <meshStandardMaterial color={STEEL} metalness={0.9} roughness={0.3} />;
  return (
    <MergeStatic key={`${b.x0}|${b.x1}|${b.z0}|${b.z1}`}>
      {/* parede de frente (z1) com vão de porta */}
      {[
        { x: (b.x0 + (doorX - doorW / 2)) / 2, len: doorX - doorW / 2 - b.x0 },
        { x: (doorX + doorW / 2 + b.x1) / 2, len: b.x1 - (doorX + doorW / 2) },
      ].map((s, i) => (
        <mesh key={i} position={[s.x, H / 2, b.z1]}>
          <planeGeometry args={[s.len, H]} />
          {glass}
        </mesh>
      ))}
      {/* lateral direita (x1) */}
      <mesh position={[b.x1, H / 2, (b.z0 + b.z1) / 2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[d, H]} />
        {glass}
      </mesh>
      {/* montantes */}
      {[b.x0, doorX - doorW / 2, doorX + doorW / 2, b.x1].map((x, i) => (
        <mesh key={i} position={[x, H / 2, b.z1]} castShadow>
          <boxGeometry args={[0.06, H, 0.06]} />
          {frame}
        </mesh>
      ))}
      <mesh position={[b.x1, H / 2, b.z0]} castShadow>
        <boxGeometry args={[0.06, H, 0.06]} />
        {frame}
      </mesh>
      <mesh position={[b.x1, H / 2, (b.z0 + b.z1) / 2]} castShadow>
        <boxGeometry args={[0.06, H, 0.06]} />
        {frame}
      </mesh>
      {/* verga, friso de LED e letreiro */}
      <mesh position={[(b.x0 + b.x1) / 2, H, b.z1]} castShadow>
        <boxGeometry args={[w + 0.08, 0.1, 0.1]} />
        {frame}
      </mesh>
      <mesh position={[(b.x0 + b.x1) / 2, H - 0.12, b.z1 + 0.04]}>
        <boxGeometry args={[w, 0.03, 0.03]} />
        <meshStandardMaterial color={PALETTE.brand} emissive={PALETTE.brand} emissiveIntensity={1.2} toneMapped={false} />
      </mesh>
      <mesh position={[doorX, H + 0.32, b.z1 + 0.03]} material={signMat}>
        <planeGeometry args={[3.0, 0.375]} />
      </mesh>
      {/* piso técnico mais escuro e luz fria dentro do recinto */}
      <mesh position={[(b.x0 + b.x1) / 2, 0.012, (b.z0 + b.z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#1a1f27" roughness={0.55} metalness={0.2} envMapIntensity={0.8} />
      </mesh>
      {quality === "high" && <pointLight position={[(b.x0 + b.x1) / 2, H - 0.3, (b.z0 + b.z1) / 2]} intensity={1.6} color="#9ec5ff" distance={Math.max(w, d) * 1.4} decay={1.8} />}
    </MergeStatic>
  );
}
