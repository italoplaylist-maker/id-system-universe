"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import type { QualityProfile } from "./quality";

/**
 * Ambiente refletido procedural ("estúdio de arquitetura"): painéis de luz de teto, uma janela
 * fria e uma faixa de LED vermelho. Não depende de HDRI externo — o cubemap é gerado uma única
 * vez na GPU e dá a vidro, metal escovado e madeira algo para refletir.
 *
 * A luz de dia/noite entra por `daylight` (0..1), quantizada em degraus para o mapa só ser
 * regenerado algumas vezes ao longo do dia, nunca a cada frame.
 */
function ProceduralEnvironment({ daylight, profile }: { daylight: number; profile: QualityProfile }) {
  const step = Math.round(daylight * 4) / 4;
  const intensity = 0.25 + step * 0.55;
  const windowColor = useMemo(() => (step > 0.5 ? "#cfe3ff" : "#3a4a78"), [step]);
  const ceilingStrength = 1.6 - step * 0.4;

  return (
    <Environment key={`${step}-${profile.environmentResolution}`} resolution={profile.environmentResolution} environmentIntensity={intensity} frames={1}>
      {/* teto: faixas quentes paralelas, como luminárias lineares embutidas */}
      {[-6, 0, 6].map((x) => (
        <Lightformer key={x} form="rect" intensity={ceilingStrength} color="#ffe2b8" position={[x, 8, 0]} rotation-x={Math.PI / 2} scale={[2.2, 18, 1]} />
      ))}
      {/* janela fria lateral */}
      <Lightformer form="rect" intensity={0.9 + step * 2.2} color={windowColor} position={[-12, 4, 2]} rotation-y={Math.PI / 2} scale={[14, 6, 1]} />
      {/* contra-luz suave do lado oposto */}
      <Lightformer form="rect" intensity={0.6} color="#fff0d6" position={[12, 3, -4]} rotation-y={-Math.PI / 2} scale={[10, 4, 1]} />
      {/* LED vermelho ID System */}
      <Lightformer form="rect" intensity={1.4 - step * 0.6} color="#e8283f" position={[0, 1.2, -12]} scale={[16, 0.35, 1]} />
    </Environment>
  );
}

/**
 * Dia: HDRI de estúdio real (Poly Haven "Brown Photostudio 02", CC0, 1k) para reflexos naturais.
 * Noite (ou enquanto o HDRI carrega): ambiente procedural, que carrega a identidade vermelha da ID System.
 */
export function StudioEnvironment({ daylight, profile }: { daylight: number; profile: QualityProfile }) {
  const step = Math.round(daylight * 4) / 4;
  const procedural = <ProceduralEnvironment daylight={daylight} profile={profile} />;
  if (step <= 0.25) return procedural;
  return (
    <Suspense fallback={procedural}>
      <Environment files="/hdri/brown_photostudio_02_1k.hdr" environmentIntensity={0.3 + step * 0.3} environmentRotation={[0, Math.PI * 0.35, 0]} />
    </Suspense>
  );
}
