"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ActorVisual } from "../life/sim";

export type EmployeePose = "standing" | "seated";
export type EmployeeActivity = "idle" | "working";

interface EmployeeModelProps {
  /** Cor do tronco (identifica o funcionário de longe). */
  accent?: string;
  pose?: EmployeePose;
  activity?: EmployeeActivity;
  /** Escolha determinística de cabelo/chapéu/calça/óculos — o mesmo funcionário sempre tem a mesma cara. */
  seed?: number;
  /** Desliga o movimento secundário (respiração, balanço) — gráficos reduzidos. */
  reduced?: boolean;
  /**
   * Quando presente, a pose vem da simulação da vida dos agentes (andar, sentar e trabalhar) e substitui
   * `pose`/`activity`. O objeto é mutado pela simulação a cada frame.
   */
  visual?: ActorVisual;
}

/**
 * Minifigura de Lego, ~1,5 m, em peças simples (poucas malhas: lê bem de longe e custa pouco com dezenas de personagens).
 * Junta do quadril fixa a 0,50 m — a mesma altura do assento das cadeiras, de pé ou sentado. Frente = +z.
 * Só visual: a operação real nunca depende deste componente.
 */
const HIP = 0.5;
const LEG_LEN = 0.5;

const YELLOW = "#f6c914";
const HAIR_COLOR = ["#1d1713", "#3a2618", "#5b3a22", "#c9923a", "#2a2a2e", "#d8d8de", "#8a2f1f"];
const PANTS = ["#26324f", "#1f2937", "#3b3b3f", "#5a4632", "#2b4a3f"];
const HEAD_GEAR = ["short", "short", "long", "ponytail", "cap", "hardhat", "none"] as const;

function pickFrom<T>(options: readonly T[], seed: number, salt: number): T {
  return options[Math.abs(Math.imul(seed + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) % options.length];
}

const lerp = THREE.MathUtils.lerp;
const damp = (current: number, target: number, lambda: number, dt: number) => current + (target - current) * (1 - Math.exp(-lambda * dt));

// Geometrias unitárias compartilhadas por TODOS os personagens (escala por malha dá o tamanho de cada peça).
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 22);
const DISC = new THREE.CircleGeometry(1, 14);
const SMILE = new THREE.TorusGeometry(0.078, 0.009, 6, 18, Math.PI);
const SPECS = new THREE.TorusGeometry(0.05, 0.008, 6, 16);

// Materiais em cache por cor (conjunto pequeno e finito: nunca é descartado).
const materials = new Map<string, THREE.MeshStandardMaterial>();
function plastic(color: string, roughness = 0.32): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
    materials.set(key, m);
  }
  return m;
}

function Hat({ kind, hair, accent }: { kind: (typeof HEAD_GEAR)[number]; hair: string; accent: string }) {
  if (kind === "none") return null;
  if (kind === "cap") {
    const m = plastic(accent);
    return (
      <group>
        <mesh geometry={CYL} material={m} position={[0, 0.2, 0]} scale={[0.222, 0.09, 0.222]} castShadow />
        <mesh geometry={BOX} material={m} position={[0, 0.16, 0.25]} scale={[0.3, 0.025, 0.22]} />
      </group>
    );
  }
  if (kind === "hardhat") {
    const m = plastic("#ffc400");
    return (
      <group>
        <mesh geometry={CYL} material={m} position={[0, 0.21, 0]} scale={[0.225, 0.11, 0.225]} castShadow />
        <mesh geometry={CYL} material={m} position={[0, 0.16, 0]} scale={[0.29, 0.02, 0.29]} />
        <mesh geometry={BOX} material={m} position={[0, 0.275, 0]} scale={[0.07, 0.04, 0.3]} />
      </group>
    );
  }
  const m = plastic(hair, 0.5);
  return (
    <group>
      <mesh geometry={CYL} material={m} position={[0, 0.115, -0.01]} scale={[0.212, 0.14, 0.212]} castShadow />
      {kind === "long" && <mesh geometry={BOX} material={m} position={[0, -0.02, -0.2]} scale={[0.4, 0.36, 0.1]} />}
      {kind === "ponytail" && <mesh geometry={CYL} material={m} position={[0, 0.0, -0.27]} scale={[0.05, 0.22, 0.05]} />}
    </group>
  );
}

/** Funcionário do escritório (mesas de projeto e agentes). Pose/atividade vêm de props simples ou da simulação de vida. */
export function EmployeeModel({ accent = "#38bdf8", pose = "standing", activity = "idle", seed = 0, reduced = false, visual }: EmployeeModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const spineRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  // Props simples (mesas dos projetos) viram um "visual" estático; a vida dos agentes passa o seu próprio.
  const legacy = useRef<ActorVisual>({ gait: 0, walk: 0, sit: pose === "seated" ? 1 : 0, work: activity === "working" ? 1 : 0 });

  const look = useMemo(
    () => ({
      gear: pickFrom(HEAD_GEAR, seed, 4),
      hair: pickFrom(HAIR_COLOR, seed, 3),
      pants: pickFrom(PANTS, seed, 6),
      glasses: pickFrom([false, false, true], seed, 7),
      wink: pickFrom([false, false, false, true], seed, 9),
    }),
    [seed],
  );
  const phase = (seed % 97) * 0.37;
  const topY = look.gear === "none" ? 0.17 : look.gear === "short" || look.gear === "long" || look.gear === "ponytail" ? 0.185 : 0.17;

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = clock.elapsedTime + phase;
    let v: ActorVisual;
    if (visual) v = visual;
    else {
      v = legacy.current;
      v.sit = pose === "seated" ? 1 : 0;
      v.work = damp(v.work, activity === "working" ? 1 : 0, 7, dt);
    }
    const sit = v.sit;
    const w = v.work;
    const walk = v.walk * (1 - sit);
    const swing = Math.sin(v.gait);

    // Anda: sobe e desce levemente a cada passo.
    if (rootRef.current) rootRef.current.position.y = reduced ? 0 : Math.abs(swing) * 0.03 * walk;

    // Pernas rígidas, giram só no quadril: balançam ao andar e ficam na horizontal sentado.
    const sitLeg = -Math.PI / 2 + 0.06;
    if (legL.current) legL.current.rotation.x = lerp(swing * 0.55 * walk, sitLeg, sit);
    if (legR.current) legR.current.rotation.x = lerp(-swing * 0.55 * walk, sitLeg, sit);

    // Tronco: inclina para o teclado ao trabalhar; respira parado.
    const breathe = reduced ? 0 : Math.sin(t * 1.6) * 0.012;
    const lean = lerp(0.02 + 0.05 * walk + breathe, 0.05 + 0.15 * w, sit);
    if (spineRef.current) spineRef.current.rotation.x = lean;

    // Cabeça: olha em volta quando livre; abaixa para a tela quando trabalha.
    if (headRef.current) {
      headRef.current.rotation.y = reduced ? 0 : Math.sin(t * 0.37) * 0.22 * (1 - w);
      headRef.current.rotation.x = -lean * 0.6 + 0.16 * w * sit;
    }

    // Braços: balançam ao andar; sentados, repousam no colo ou digitam (as mãos chegam ao teclado).
    const sway = reduced ? 0 : Math.sin(t * 1.6) * 0.035;
    const rest = lerp(0.04 + sway, -0.65 - lean, sit);
    const typeBase = -1.28;
    const tapL = reduced ? 0 : Math.sin(t * 15) * 0.05 * w;
    const tapR = reduced ? 0 : Math.sin(t * 11 + 2.1) * 0.05 * w;
    if (armL.current) armL.current.rotation.x = lerp(rest + swing * 0.5 * walk, typeBase + tapL, w * sit);
    if (armR.current) armR.current.rotation.x = lerp(rest - swing * 0.5 * walk, typeBase + tapR, w * sit);
  });

  const torso = plastic(accent);
  const legs = plastic(look.pants);
  const skin = plastic(YELLOW);
  const dark = plastic("#1b1b1f", 0.6);
  const white = plastic("#f2f4f8", 0.5);

  return (
    <group ref={rootRef}>
      {/* pernas: pivô no quadril (junta fixa a 0,50 m) */}
      {[-1, 1].map((s) => (
        <group key={s} ref={s < 0 ? legL : legR} position={[s * 0.105, HIP, 0]}>
          <mesh geometry={BOX} material={legs} position={[0, -LEG_LEN / 2, 0]} scale={[0.2, LEG_LEN, 0.25]} castShadow />
        </group>
      ))}

      {/* corpo: pivô no quadril, inclina inteiro */}
      <group ref={spineRef} position={[0, HIP, 0]}>
        <mesh geometry={BOX} material={legs} position={[0, 0.065, 0]} scale={[0.43, 0.13, 0.27]} castShadow />
        <mesh geometry={BOX} material={torso} position={[0, 0.36, 0]} scale={[0.44, 0.46, 0.26]} castShadow />
        {/* crachá do ID System no peito */}
        <mesh geometry={BOX} material={white} position={[0.1, 0.43, 0.132]} scale={[0.1, 0.13, 0.01]} />
        <mesh geometry={BOX} material={plastic("#e8283f")} position={[0.1, 0.475, 0.139]} scale={[0.1, 0.03, 0.01]} />
        {/* pescoço (pino) */}
        <mesh geometry={CYL} material={skin} position={[0, 0.61, 0]} scale={[0.075, 0.045, 0.075]} />

        {/* braços: pivô no ombro; mão em "C" simplificada */}
        {[-1, 1].map((s) => (
          <group key={s} ref={s < 0 ? armL : armR} position={[s * 0.285, 0.54, 0]}>
            <mesh geometry={BOX} material={torso} position={[0, -0.2, 0]} scale={[0.13, 0.4, 0.15]} castShadow />
            <mesh geometry={CYL} material={skin} position={[0, -0.45, 0.01]} rotation={[0, 0, Math.PI / 2]} scale={[0.062, 0.085, 0.062]} />
          </group>
        ))}

        {/* cabeça */}
        <group ref={headRef} position={[0, 0.61 + 0.02 + 0.17, 0]}>
          <mesh geometry={CYL} material={skin} scale={[0.2, 0.34, 0.2]} castShadow />
          <mesh geometry={CYL} material={skin} position={[0, topY + 0.02, 0]} scale={[0.085, 0.045, 0.085]} />
          {/* rosto */}
          <mesh geometry={DISC} material={dark} position={[-0.07, 0.04, 0.1925]} scale={[0.024, look.wink ? 0.006 : 0.03, 1]} />
          <mesh geometry={DISC} material={dark} position={[0.07, 0.04, 0.1925]} scale={[0.024, 0.03, 1]} />
          <mesh geometry={SMILE} material={dark} position={[0, -0.025, 0.1955]} rotation={[0, 0, Math.PI]} />
          {look.glasses && (
            <>
              <mesh geometry={SPECS} material={dark} position={[-0.07, 0.04, 0.195]} />
              <mesh geometry={SPECS} material={dark} position={[0.07, 0.04, 0.195]} />
              <mesh geometry={BOX} material={dark} position={[0, 0.045, 0.197]} scale={[0.05, 0.01, 0.008]} />
            </>
          )}
          <Hat kind={look.gear} hair={look.hair} accent={accent} />
        </group>
      </group>
    </group>
  );
}
