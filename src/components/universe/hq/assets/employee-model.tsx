"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { solveLeg, solveLimb } from "./rig-ik";
import type { ActorVisual } from "../life/sim";

export type EmployeePose = "standing" | "seated";
export type EmployeeActivity = "idle" | "working";

interface EmployeeModelProps {
  accent?: string;
  pose?: EmployeePose;
  activity?: EmployeeActivity;
  /** Deterministic wardrobe/hair/skin pick — the same project always gets the same person. */
  seed?: number;
  /** Skips secondary motion (breathing, sway) — Reduced Graphics. */
  reduced?: boolean;
  /**
   * Quando presente, a pose vem da simulação da vida dos agentes (andar, sentar, beber, sinuca,
   * conversar) e substitui `pose`/`activity`. O objeto é mutado pela simulação a cada frame.
   */
  visual?: ActorVisual;
}

// Human proportions for a 1.70 m stylized corporate character. Forward is +z in local space.
const D = {
  HIP_STAND: 0.92,
  HIP_SEAT: 0.5,
  THIGH: 0.45,
  SHIN: 0.42,
  TORSO: 0.5,
  SHOULDER_X: 0.2,
  UPPER_ARM: 0.29,
  FOREARM: 0.26,
  NECK: 0.07,
  HEAD_R: 0.105,
} as const;

const SKIN = ["#f1c9a5", "#e0ac84", "#c68b62", "#a56b46", "#7a4b32"];
const HAIR_COLOR = ["#1d1713", "#3a2618", "#5b3a22", "#8a6a3c", "#2a2a2e", "#9a9aa2"];
const SHIRT = ["#2f5f8a", "#4b6a9b", "#3d7a6a", "#7a4f6d", "#8a5a3a", "#34495e", "#c9ccd4", "#5b4b8a"];
const PANTS = ["#23262d", "#2c3140", "#3a3a3f", "#2b3a33"];
const HAIR_STYLE = ["short", "long", "bun", "buzz", "curly"] as const;
type HairStyle = (typeof HAIR_STYLE)[number];
const OUTFIT = ["shirt", "hoodie", "blazer"] as const;

function pickFrom<T>(options: readonly T[], seed: number, salt: number): T {
  return options[Math.abs(Math.imul(seed + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) % options.length];
}

/** Exponential approach, frame-rate independent — same feel at 30 and 144 fps. */
function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** Arm IK: shoulder → wrist target in the sagittal (y,z) plane. */
function solveArm(shoulderY: number, shoulderZ: number, targetY: number, targetZ: number): { upper: number; elbow: number } {
  return solveLimb(D.UPPER_ARM, D.FOREARM, shoulderY, shoulderZ, targetY, targetZ);
}

const FOOT_FLOOR = 0.07;
const lerp = THREE.MathUtils.lerp;

/** Pose assentos: onde ficam os pés e as mãos de quem está sentado em cada tipo de móvel. */
const SEAT_POSE = {
  desk: { footY: FOOT_FLOOR, footZ: 0.42, handY: 0.64, handZ: 0.3 },
  sofa: { footY: FOOT_FLOOR, footZ: 0.5, handY: 0.6, handZ: 0.28 },
  armchair: { footY: FOOT_FLOOR, footZ: 0.46, handY: 0.58, handZ: 0.26 },
  stool: { footY: 0.3, footZ: 0.3, handY: 1.07, handZ: 0.55 },
} as const;

function Hair({ style, color }: { style: HairStyle; color: string }) {
  const r = D.HEAD_R;
  const material = <meshStandardMaterial color={color} roughness={0.8} />;
  if (style === "buzz") {
    return (
      <mesh position={[0, 0.012, -0.004]}>
        <sphereGeometry args={[r * 1.03, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        {material}
      </mesh>
    );
  }
  return (
    <group>
      <mesh position={[0, 0.02, -0.012]} rotation={[-0.25, 0, 0]}>
        <sphereGeometry args={[r * 1.1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
        {material}
      </mesh>
      {style === "long" && (
        <mesh position={[0, -0.07, -0.07]}>
          <capsuleGeometry args={[r * 0.9, 0.16, 6, 14]} />
          {material}
        </mesh>
      )}
      {style === "bun" && (
        <mesh position={[0, 0.115, -0.07]}>
          <sphereGeometry args={[0.05, 12, 10]} />
          {material}
        </mesh>
      )}
      {style === "curly" &&
        [-0.07, 0, 0.07].map((x) => (
          <mesh key={x} position={[x, 0.09, -0.02]}>
            <sphereGeometry args={[0.052, 10, 8]} />
            {material}
          </mesh>
        ))}
    </group>
  );
}

/**
 * The project's employee: smooth capsule/sphere anatomy (head, neck, torso, pelvis, upper
 * arms, forearms, hands, thighs, shins, shoes) on a real joint hierarchy. Seated arms are
 * solved with two-bone IK so the hands actually land on the keyboard instead of floating,
 * and working/idle changes are damped over ~250 ms instead of snapping. Pure visual — the
 * real operation never depends on this component.
 */
export function EmployeeModel({ accent = "#38bdf8", pose = "standing", activity = "idle", seed = 0, reduced = false, visual }: EmployeeModelProps) {
  const hipRef = useRef<THREE.Group>(null);
  const spineRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const leftElbow = useRef<THREE.Group>(null);
  const rightElbow = useRef<THREE.Group>(null);
  const leftThigh = useRef<THREE.Group>(null);
  const rightThigh = useRef<THREE.Group>(null);
  const leftKnee = useRef<THREE.Group>(null);
  const rightKnee = useRef<THREE.Group>(null);
  const glassRef = useRef<THREE.Group>(null);
  const cueRef = useRef<THREE.Group>(null);
  // Props simples (mesas dos projetos) viram um "visual" estático; a vida dos agentes passa o seu próprio.
  const legacy = useRef<ActorVisual>({
    gait: 0, walk: 0, sit: pose === "seated" ? 1 : 0, seatKind: "desk", hipSeat: 0.5, backLean: 0, work: activity === "working" ? 1 : 0,
    talk: 0, drink: 0, pool: 0, stroke: 0, glass: false, cue: false, lookYaw: 0,
  });

  const look = useMemo(() => {
    const outfit = pickFrom(OUTFIT, seed, 1);
    return {
      skin: pickFrom(SKIN, seed, 2),
      hair: pickFrom(HAIR_COLOR, seed, 3),
      hairStyle: pickFrom(HAIR_STYLE, seed, 4),
      shirt: pickFrom(SHIRT, seed, 5),
      pants: pickFrom(PANTS, seed, 6),
      outfit,
      glasses: pickFrom([false, false, true], seed, 7),
      shoes: pickFrom(["#f2f2f4", "#1b1b1f", "#d9d9de"], seed, 8),
    };
  }, [seed]);

  const phase = (seed % 97) * 0.37;

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
    const seat = SEAT_POSE[v.seatKind];

    // ---- quadril: altura de pé (com balanço de caminhada) → altura sentado --------------------------
    const pool = v.pool;
    const standHip = D.HIP_STAND - 0.02 * walk - 0.05 * pool + (reduced ? 0 : Math.cos(v.gait * 2) * 0.016 * walk);
    const hipY = lerp(standHip, v.hipSeat, sit);
    if (hipRef.current) hipRef.current.position.y = hipY;

    // ---- tronco -----------------------------------------------------------------------------------
    const breathe = reduced ? 0 : Math.sin(t * 1.6) * 0.004;
    const seatedLean = v.seatKind === "desk" ? lerp(0.03, 0.16, w) : v.backLean;
    const lean = lerp(0.01 + 0.07 * walk, seatedLean, sit) + pool * 0.8 + breathe;
    if (spineRef.current) {
      spineRef.current.rotation.x = lean;
      spineRef.current.rotation.y = reduced ? 0 : Math.sin(v.gait) * 0.12 * walk;
    }
    if (headRef.current) {
      const glance = reduced ? 0 : Math.sin(t * 0.37) * 0.05 * (1 - w) * (1 - v.talk);
      const nod = reduced ? 0 : Math.sin(t * 3.6) * 0.05 * v.talk;
      headRef.current.rotation.x = lerp(0.02, v.seatKind === "desk" ? lerp(0.02, 0.2, w) : 0.0, sit) - lean * 0.55 + nod + pool * 0.45;
      headRef.current.rotation.y = glance + v.lookYaw;
    }

    // ---- pernas por IK: passada, sentar, postura de sinuca ------------------------------------------
    for (let side = 0; side < 2; side += 1) {
      const thigh = (side === 0 ? leftThigh : rightThigh).current;
      const knee = (side === 0 ? leftKnee : rightKnee).current;
      if (!thigh || !knee) continue;
      const off = side === 0 ? 0 : Math.PI;
      const swing = Math.sin(v.gait + off);
      const lift = Math.max(0, Math.cos(v.gait + off));
      let footZ = lerp(swing * 0.3 * walk, seat.footZ, sit);
      const footY = lerp(FOOT_FLOOR + lift * 0.11 * walk, seat.footY, sit);
      // sinuca: afastamento de pernas (uma à frente, outra atrás)
      footZ += pool * (side === 0 ? 0.3 : -0.18);
      // sentado, a perna não balança: os joelhos ficam ligeiramente abertos
      const legs = solveLeg(D.THIGH, D.SHIN, hipY, footY, footZ);
      thigh.rotation.x = legs.thigh;
      thigh.rotation.z = (side === 0 ? -1 : 1) * 0.03;
      knee.rotation.x = legs.knee;
    }

    // ---- braços por IK ----------------------------------------------------------------------------
    const shoulderY = hipY + 0.46 * Math.cos(lean);
    const shoulderZ = 0.46 * Math.sin(lean);
    const gesture = v.talk;
    for (let side = 0; side < 2; side += 1) {
      const arm = (side === 0 ? leftArm : rightArm).current;
      const elbow = (side === 0 ? leftElbow : rightElbow).current;
      if (!arm || !elbow) continue;
      const sign = side === 0 ? -1 : 1;
      const off = side === 0 ? Math.PI : 0; // braço oposto à perna

      // base: pendurado / balançando ao andar
      let targetY = hipY - 0.04 + 0.03 * walk;
      let targetZ = 0.07 + Math.sin(v.gait + off) * 0.2 * walk;
      let spread = 0.06;

      // sentado: mãos no colo / teclado / balcão
      if (sit > 0.001) {
        let seatedY: number;
        let seatedZ: number;
        if (v.seatKind === "desk") {
          const keyboardY = 0.79 + (reduced ? 0 : Math.sin(t * 15 + side * 2.1) * 0.006 * w);
          const mouseMix = side === 1 && !reduced ? THREE.MathUtils.smoothstep(Math.sin(t * 0.45), 0.3, 0.8) : 0;
          seatedY = lerp(seat.handY, keyboardY, w);
          seatedZ = lerp(seat.handZ, 0.56 + mouseMix * 0.04 + (reduced ? 0 : Math.sin(t * 11 + side) * 0.008 * w), w);
        } else if (v.seatKind === "stool") {
          seatedY = seat.handY;
          seatedZ = seat.handZ - (side === 0 ? 0.04 : 0);
        } else {
          seatedY = hipY + 0.1;
          seatedZ = seat.handZ + (reduced ? 0 : Math.sin(t * 0.8 + side) * 0.02);
        }
        targetY = lerp(targetY, seatedY, sit);
        targetZ = lerp(targetZ, seatedZ, sit);
        spread = lerp(spread, 0.1, sit);
      }

      // conversa em pé: a mão direita gesticula, a esquerda acompanha de leve
      if (gesture > 0.001) {
        const g = gesture * (side === 1 ? 1 : 0.35);
        targetY = lerp(targetY, hipY + 0.2 + (reduced ? 0 : Math.sin(t * 3.1 + side) * 0.06), g);
        targetZ = lerp(targetZ, 0.3 + (reduced ? 0 : Math.sin(t * 2.3 + side * 1.7) * 0.08), g);
      }

      // sinuca: esquerda faz a "ponte" sobre o pano, direita empunha o taco
      if (pool > 0.001) {
        if (side === 0) {
          targetY = lerp(targetY, 0.88, pool);
          targetZ = lerp(targetZ, 0.78, pool);
        } else {
          targetY = lerp(targetY, 0.98, pool);
          targetZ = lerp(targetZ, 0.18 + v.stroke * 0.3, pool);
        }
        spread = lerp(spread, side === 0 ? 0.12 : 0.02, pool);
      } else if (v.cue && side === 1) {
        // espera a vez com o taco apoiado no chão
        targetY = hipY + 0.02;
        targetZ = 0.2;
      }

      // beber: a mão direita leva o copo à boca
      if (v.drink > 0.001 && side === 1) {
        targetY = lerp(targetY, shoulderY + 0.12, v.drink);
        targetZ = lerp(targetZ, shoulderZ + 0.18, v.drink);
      }

      const solved = solveArm(shoulderY, shoulderZ, targetY, targetZ);
      arm.rotation.x = solved.upper - lean;
      arm.rotation.z = sign * spread;
      elbow.rotation.x = solved.elbow;
    }

    // ---- objetos nas mãos ---------------------------------------------------------------------------
    if (glassRef.current) glassRef.current.visible = v.drink > 0.04;
    if (cueRef.current) {
      cueRef.current.visible = v.cue;
      if (v.cue) {
        // inclinação absoluta desejada do taco: ~na vertical (apoiado) → quase horizontal (jogando)
        const desired = lerp(1.42, 0.1, pool);
        const forearmAbs = (rightArm.current?.rotation.x ?? 0) + lean + (rightElbow.current?.rotation.x ?? 0);
        cueRef.current.rotation.x = desired - forearmAbs;
      }
    }
  });

  const sleeve = look.outfit === "hoodie" || look.outfit === "blazer" ? look.shirt : look.shirt;
  const forearmColor = look.outfit === "shirt" ? look.skin : sleeve;

  return (
    <group>
      <group ref={hipRef} position={[0, D.HIP_STAND, 0]}>
        {/* pelvis */}
        <mesh position={[0, 0.0, 0]} scale={[1, 0.62, 0.78]} castShadow>
          <sphereGeometry args={[0.165, 18, 14]} />
          <meshStandardMaterial color={look.pants} roughness={0.85} />
        </mesh>

        <group ref={spineRef} position={[0, 0.02, 0]}>
          {/* torso */}
          <mesh position={[0, 0.25, 0]} scale={[1, 1, 0.66]} castShadow>
            <cylinderGeometry args={[0.185, 0.155, D.TORSO, 20]} />
            <meshStandardMaterial color={look.shirt} roughness={0.78} />
          </mesh>
          {/* shoulders */}
          <mesh position={[0, 0.44, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.8]} castShadow>
            <capsuleGeometry args={[0.07, 0.26, 6, 14]} />
            <meshStandardMaterial color={look.shirt} roughness={0.78} />
          </mesh>
          {look.outfit === "blazer" && (
            <mesh position={[0, 0.3, 0.1]} rotation={[0.05, 0, 0]}>
              <boxGeometry args={[0.07, 0.34, 0.012]} />
              <meshStandardMaterial color="#e8ebf2" roughness={0.7} />
            </mesh>
          )}
          {look.outfit === "hoodie" && (
            <mesh position={[0, 0.5, -0.06]} rotation={[0.4, 0, 0]} scale={[1, 0.5, 1]}>
              <torusGeometry args={[0.1, 0.035, 8, 18]} />
              <meshStandardMaterial color={look.shirt} roughness={0.9} />
            </mesh>
          )}
          {/* ID lanyard in the project's accent color */}
          <mesh position={[0, 0.3, 0.125]} rotation={[0.08, 0, 0]}>
            <boxGeometry args={[0.02, 0.3, 0.008]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} />
          </mesh>
          <mesh position={[0, 0.16, 0.13]}>
            <boxGeometry args={[0.065, 0.08, 0.01]} />
            <meshStandardMaterial color="#f4f5f8" roughness={0.5} />
          </mesh>

          {/* neck + head */}
          <mesh position={[0, 0.53, 0]}>
            <cylinderGeometry args={[0.045, 0.05, D.NECK + 0.03, 12]} />
            <meshStandardMaterial color={look.skin} roughness={0.6} />
          </mesh>
          <group ref={headRef} position={[0, 0.57, 0.005]}>
            <group position={[0, D.HEAD_R + 0.03, 0.01]}>
              <mesh scale={[0.92, 1.06, 0.98]} castShadow>
                <sphereGeometry args={[D.HEAD_R, 24, 18]} />
                <meshStandardMaterial color={look.skin} roughness={0.55} />
              </mesh>
              <Hair style={look.hairStyle} color={look.hair} />
              {[-0.036, 0.036].map((x) => (
                <mesh key={x} position={[x, 0.01, D.HEAD_R * 0.9]}>
                  <sphereGeometry args={[0.012, 8, 8]} />
                  <meshStandardMaterial color="#1c1c22" roughness={0.3} />
                </mesh>
              ))}
              <mesh position={[0, -0.012, D.HEAD_R * 0.97]}>
                <sphereGeometry args={[0.012, 8, 8]} />
                <meshStandardMaterial color={look.skin} roughness={0.6} />
              </mesh>
              {[-1, 1].map((s) => (
                <mesh key={s} position={[s * D.HEAD_R * 0.9, 0, 0]} scale={[0.5, 1, 0.8]}>
                  <sphereGeometry args={[0.022, 8, 8]} />
                  <meshStandardMaterial color={look.skin} roughness={0.6} />
                </mesh>
              ))}
              {look.glasses && (
                <group position={[0, 0.012, D.HEAD_R * 0.93]}>
                  {[-0.036, 0.036].map((x) => (
                    <mesh key={x} position={[x, 0, 0]}>
                      <torusGeometry args={[0.022, 0.003, 6, 16]} />
                      <meshStandardMaterial color="#15171c" metalness={0.5} roughness={0.35} />
                    </mesh>
                  ))}
                </group>
              )}
            </group>
          </group>

          {/* arms: shoulder → elbow → hand */}
          {[-1, 1].map((sign, side) => (
            <group key={sign} ref={side === 0 ? leftArm : rightArm} position={[sign * D.SHOULDER_X, 0.44, 0]}>
              <mesh position={[0, -D.UPPER_ARM / 2, 0]} castShadow>
                <capsuleGeometry args={[0.042, D.UPPER_ARM - 0.06, 6, 12]} />
                <meshStandardMaterial color={sleeve} roughness={0.78} />
              </mesh>
              <group ref={side === 0 ? leftElbow : rightElbow} position={[0, -D.UPPER_ARM, 0]}>
                <mesh position={[0, -D.FOREARM / 2, 0]}>
                  <capsuleGeometry args={[0.036, D.FOREARM - 0.05, 6, 12]} />
                  <meshStandardMaterial color={forearmColor} roughness={look.outfit === "shirt" ? 0.6 : 0.78} />
                </mesh>
                <mesh position={[0, -D.FOREARM - 0.035, 0.012]} scale={[1, 1.15, 0.8]}>
                  <sphereGeometry args={[0.038, 12, 10]} />
                  <meshStandardMaterial color={look.skin} roughness={0.6} />
                </mesh>
                {side === 1 && (
                  <>
                    {/* copo na mão direita (só aparece ao beber) */}
                    <group ref={glassRef} position={[0, -D.FOREARM - 0.06, 0.035]} visible={false}>
                      <mesh position={[0, 0.045, 0]} castShadow>
                        <cylinderGeometry args={[0.032, 0.026, 0.1, 14]} />
                        <meshStandardMaterial color="#cfe8ff" transparent opacity={0.55} roughness={0.08} metalness={0.1} />
                      </mesh>
                      <mesh position={[0, 0.03, 0]}>
                        <cylinderGeometry args={[0.027, 0.022, 0.05, 14]} />
                        <meshStandardMaterial color="#e8a33d" roughness={0.3} />
                      </mesh>
                    </group>
                    {/* taco de sinuca */}
                    <group ref={cueRef} position={[0, -D.FOREARM - 0.03, 0.02]} visible={false}>
                      <mesh position={[0, 0, 0.2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                        <cylinderGeometry args={[0.009, 0.015, 1.45, 10]} />
                        <meshStandardMaterial color="#c8a06a" roughness={0.5} />
                      </mesh>
                      <mesh position={[0, 0, 0.93]} rotation={[Math.PI / 2, 0, 0]}>
                        <cylinderGeometry args={[0.0095, 0.0095, 0.03, 10]} />
                        <meshStandardMaterial color="#3b82c4" roughness={0.7} />
                      </mesh>
                      <mesh position={[0, 0, -0.45]} rotation={[Math.PI / 2, 0, 0]}>
                        <cylinderGeometry args={[0.016, 0.016, 0.3, 10]} />
                        <meshStandardMaterial color="#1b1b1f" roughness={0.6} />
                      </mesh>
                    </group>
                  </>
                )}
              </group>
            </group>
          ))}
        </group>

        {/* legs: hip → knee → shoe, driven by IK every frame (stride, sitting, pool stance). */}
        {[-1, 1].map((sign) => (
          <group key={sign} ref={sign === -1 ? leftThigh : rightThigh} position={[sign * 0.09, 0, 0]}>
            <mesh position={[0, -D.THIGH / 2, 0]} castShadow>
              <capsuleGeometry args={[0.07, D.THIGH - 0.1, 6, 14]} />
              <meshStandardMaterial color={look.pants} roughness={0.85} />
            </mesh>
            <group ref={sign === -1 ? leftKnee : rightKnee} position={[0, -D.THIGH, 0]}>
              <mesh position={[0, -D.SHIN / 2, 0]} castShadow>
                <capsuleGeometry args={[0.055, D.SHIN - 0.08, 6, 14]} />
                <meshStandardMaterial color={look.pants} roughness={0.85} />
              </mesh>
              <mesh position={[0, -D.SHIN - 0.035, 0.05]}>
                <boxGeometry args={[0.095, 0.07, 0.24]} />
                <meshStandardMaterial color={look.shoes} roughness={0.55} />
              </mesh>
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}
