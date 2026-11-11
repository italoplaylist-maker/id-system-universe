"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { TallPlant } from "./office-props";
import type { CltLayout } from "../plan/clt-layout";
import { COMMERCIAL_LABEL } from "@/lib/commercial-team";

/** Identidade visual da ilha COMERCIAL & MARKETING: âmbar e verde-água (a ilha técnica é vermelho e azul). */
export const COMMERCIAL_ACCENT = "#f59e0b";
export const COMMERCIAL_TEAL = "#14b8a6";

export interface CommercialIndicators {
  leadsFound: number;
  qualified: number;
  researched: number;
  open: number;
  pendingApproaches: number;
  converted: number;
  conversionRate: number | null;
  costMonth: number | null;
  tokensMonth: number;
}

const card: React.CSSProperties = { background: "rgba(8,18,20,0.92)", border: `1px solid ${COMMERCIAL_TEAL}`, borderRadius: 10, padding: "8px 10px", color: "#e6f6f4", fontFamily: "ui-sans-serif, system-ui", width: 224, cursor: "pointer", boxShadow: `0 0 18px ${COMMERCIAL_TEAL}44` };
const num: React.CSSProperties = { fontSize: 15, fontWeight: 700, lineHeight: 1.1, color: "#fff" };
const cap: React.CSSProperties = { fontSize: 8.5, letterSpacing: 0.4, textTransform: "uppercase", color: "#7fb9b3" };

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} mi` : n >= 1000 ? `${Math.round(n / 1000)} mil` : String(n));

function Stat({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <div>
      <div style={{ ...num, color: hot ? COMMERCIAL_ACCENT : "#fff" }}>{value}</div>
      <div style={cap}>{label}</div>
    </div>
  );
}

/** Núcleo da ilha comercial: pedestal com anel de LED âmbar, holograma girando e o cartão de indicadores REAIS (do banco). */
function CommercialCore({ x, z, r, reduced, indicators, onOpen, exists }: { x: number; z: number; r: number; reduced: boolean; indicators: CommercialIndicators | null; onOpen: () => void; exists: boolean }) {
  const holo = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!reduced && holo.current) holo.current.rotation.y = -clock.elapsedTime * 0.45;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[6.2, 64]} />
        <meshStandardMaterial color="#13242a" roughness={1} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[5.95, 6.15, 64]} />
        <meshStandardMaterial color={COMMERCIAL_TEAL} emissive={COMMERCIAL_TEAL} emissiveIntensity={0.9} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r + 0.9, r + 1.0, 56]} />
        <meshStandardMaterial color={COMMERCIAL_ACCENT} emissive={COMMERCIAL_ACCENT} emissiveIntensity={0.7} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.34, 0]} castShadow receiveShadow onClick={(e) => { e.stopPropagation(); onOpen(); }}>
        <cylinderGeometry args={[r, r * 0.85, 0.68, 6]} />
        <meshStandardMaterial color="#0e1d22" roughness={0.35} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.71, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 0.78, r * 0.88, 6]} />
        <meshStandardMaterial color={COMMERCIAL_ACCENT} emissive={COMMERCIAL_ACCENT} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <group ref={holo} position={[0, 1.25, 0]}>
        <mesh>
          <octahedronGeometry args={[0.42, 0]} />
          <meshStandardMaterial color={COMMERCIAL_TEAL} emissive={COMMERCIAL_TEAL} emissiveIntensity={1} wireframe toneMapped={false} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.66, 0.012, 8, 48]} />
          <meshStandardMaterial color={COMMERCIAL_ACCENT} emissive={COMMERCIAL_ACCENT} emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
      </group>
      <pointLight position={[0, 1.8, 0]} color={COMMERCIAL_TEAL} intensity={reduced ? 0 : 6} distance={9} decay={2} />
      <Html position={[0, 2.75, 0]} center zIndexRange={[20, 0]}>
        <div style={card} onClick={onOpen} role="button" aria-label="Abrir painel da equipe Comercial e Marketing">
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, color: COMMERCIAL_ACCENT, marginBottom: 6 }}>{COMMERCIAL_LABEL}</div>
          {!exists || !indicators ? (
            <div style={{ fontSize: 11, color: "#a9d8d3" }}>{exists ? "Carregando indicadores…" : "Equipe ainda não criada — clique para criar"}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px 8px" }}>
              <Stat label="Leads" value={String(indicators.leadsFound)} />
              <Stat label="Qualificados" value={String(indicators.qualified)} />
              <Stat label="Pesquisadas" value={String(indicators.researched)} />
              <Stat label="Em aberto" value={String(indicators.open)} />
              <Stat label="Abordagens" value={String(indicators.pendingApproaches)} hot={indicators.pendingApproaches > 0} />
              <Stat label="Clientes" value={String(indicators.converted)} />
              <Stat label="Conversão" value={indicators.conversionRate === null ? "—" : `${indicators.conversionRate}%`} />
              <Stat label="Custo mês" value={indicators.costMonth === null ? fmtTokens(indicators.tokensMonth) : `R$ ${indicators.costMonth.toFixed(0)}`} />
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

/** Ilha COMERCIAL & MARKETING (dentro da mesma sala da CLT): piso circular, núcleo com indicadores e plantas. As mesas são desenhadas pela sala, em coordenadas do mundo. */
export function CommercialIsland({ layout, reduced, indicators, exists, onOpen }: { layout: CltLayout["commercial"]; reduced: boolean; indicators: CommercialIndicators | null; exists: boolean; onOpen: () => void }) {
  return (
    <>
      <CommercialCore x={layout.core.x} z={layout.core.z} r={layout.core.r} reduced={reduced} indicators={indicators} exists={exists} onOpen={onOpen} />
      {layout.plants.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <TallPlant scale={0.95} />
        </group>
      ))}
    </>
  );
}
