"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

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

/** Two-bone IK in the sagittal (y,z) plane: where the upper arm and the elbow must rotate so the wrist reaches (ty,tz). */
function solveArm(shoulderY: number, shoulderZ: number, targetY: number, targetZ: number): { upper: number; elbow: number } {
  const l1 = D.UPPER_ARM;
  const l2 = D.FOREARM;
  let dy = targetY - shoulderY;
  let dz = targetZ - shoulderZ;
  let dist = Math.hypot(dy, dz);
  const max = l1 + l2 - 0.005;
  const min = Math.abs(l1 - l2) + 0.02;
  if (dist > max) {
    dy *= max / dist;
    dz *= max / dist;
    dist = max;
  } else if (dist < min) dist = min;
  const aLine = Math.atan2(-dz, -dy);
  const alpha = Math.acos(THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
  const upper = aLine + alpha;
  const elbowY = shoulderY - l1 * Math.cos(upper);
  const elbowZ = shoulderZ - l1 * Math.sin(upper);
  const forearm = Math.atan2(-(shoulderZ + dz - elbowZ), -(shoulderY + dy - elbowY));
  return { upper, elbow: forearm - upper };
}

function Hair({ style, color }: { style: HairStyle; color: string }) {
  const r = D.HEAD_R;
  const material = <meshStandardMaterial color={color} roughness={0.8} />;
  if (style === "buzz") {
    return (
      <mesh position={[0, 0.012, -0.004]} castShadow>
        <sphereGeometry args={[r * 1.03, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        {material}
      </mesh>
    );
  }
  return (
    <group>
      <mesh position={[0, 0.02, -0.012]} rotation={[-0.25, 0, 0]} castShadow>
        <sphereGeometry args={[r * 1.1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
        {material}
      </mesh>
      {style === "long" && (
        <mesh position={[0, -0.07, -0.07]} castShadow>
          <capsuleGeometry args={[r * 0.9, 0.16, 6, 14]} />
          {material}
        </mesh>
      )}
      {style === "bun" && (
        <mesh position={[0, 0.115, -0.07]} castShadow>
          <sphereGeometry args={[0.05, 12, 10]} />
          {material}
        </mesh>
      )}
      {style === "curly" &&
        [-0.07, 0, 0.07].map((x) => (
          <mesh key={x} position={[x, 0.09, -0.02]} castShadow>
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
export function EmployeeModel({ accent = "#38bdf8", pose = "standing", activity = "idle", seed = 0, reduced = false }: EmployeeModelProps) {
  const spineRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const leftElbow = useRef<THREE.Group>(null);
  const rightElbow = useRef<THREE.Group>(null);
  const blend = useRef({ work: activity === "working" ? 1 : 0 });

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

  const seated = pose === "seated";
  const hipY = seated ? D.HIP_SEAT : D.HIP_STAND;
  const phase = (seed % 97) * 0.37;

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = clock.elapsedTime + phase;
    const b = blend.current;
    b.work = damp(b.work, activity === "working" ? 1 : 0, 7, dt);
    const w = b.work;

    const breathe = reduced ? 0 : Math.sin(t * 1.6) * 0.004;
    const lean = seated ? THREE.MathUtils.lerp(0.03, 0.16, w) + breathe : 0.01 + breathe;
    if (spineRef.current) spineRef.current.rotation.x = lean;
    if (headRef.current) {
      const glance = reduced ? 0 : Math.sin(t * 0.37) * 0.05 * (1 - w);
      headRef.current.rotation.x = (seated ? THREE.MathUtils.lerp(0.02, 0.2, w) : 0.02) - lean * 0.55;
      headRef.current.rotation.y = glance;
    }

    const shoulderY = hipY + 0.46 * Math.cos(lean);
    const shoulderZ = 0.46 * Math.sin(lean);
    for (let side = 0; side < 2; side += 1) {
      const arm = (side === 0 ? leftArm : rightArm).current;
      const elbow = (side === 0 ? leftElbow : rightElbow).current;
      if (!arm || !elbow) continue;
      const sign = side === 0 ? -1 : 1;

      let targetY: number;
      let targetZ: number;
      if (seated) {
        // Resting: hands on the thighs. Working: on the keyboard; the right hand drifts to the mouse now and then.
        const keyboardY = 0.79 + (reduced ? 0 : Math.sin(t * 15 + side * 2.1) * 0.006 * w);
        const mouseMix = side === 1 && !reduced ? THREE.MathUtils.smoothstep(Math.sin(t * 0.45), 0.3, 0.8) : 0;
        targetY = THREE.MathUtils.lerp(0.64, keyboardY, w);
        targetZ = THREE.MathUtils.lerp(0.3, 0.56 + mouseMix * 0.04 + (reduced ? 0 : Math.sin(t * 11 + side) * 0.008 * w), w);
      } else {
        targetY = hipY - 0.04;
        targetZ = 0.07;
      }
      const solved = solveArm(shoulderY, shoulderZ, targetY, targetZ);
      arm.rotation.x = solved.upper - lean;
      arm.rotation.z = sign * (seated ? 0.1 : 0.06);
      elbow.rotation.x = solved.elbow;
    }
  });

  const sleeve = look.outfit === "hoodie" || look.outfit === "blazer" ? look.shirt : look.shirt;
  const forearmColor = look.outfit === "shirt" ? look.skin : sleeve;

  return (
    <group>
      <group position={[0, hipY, 0]}>
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
          <mesh position={[0, 0.53, 0]} castShadow>
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
                <mesh position={[0, -D.FOREARM / 2, 0]} castShadow>
                  <capsuleGeometry args={[0.036, D.FOREARM - 0.05, 6, 12]} />
                  <meshStandardMaterial color={forearmColor} roughness={look.outfit === "shirt" ? 0.6 : 0.78} />
                </mesh>
                <mesh position={[0, -D.FOREARM - 0.035, 0.012]} scale={[1, 1.15, 0.8]} castShadow>
                  <sphereGeometry args={[0.038, 12, 10]} />
                  <meshStandardMaterial color={look.skin} roughness={0.6} />
                </mesh>
              </group>
            </group>
          ))}
        </group>

        {/* legs: hip → knee → shoe. Seated: thighs forward, shins down. */}
        {[-1, 1].map((sign) => (
          <group key={sign} position={[sign * 0.09, 0, 0]} rotation={[seated ? -Math.PI / 2 : 0, 0, sign * 0.03]}>
            <mesh position={[0, -D.THIGH / 2, 0]} castShadow>
              <capsuleGeometry args={[0.07, D.THIGH - 0.1, 6, 14]} />
              <meshStandardMaterial color={look.pants} roughness={0.85} />
            </mesh>
            <group position={[0, -D.THIGH, 0]} rotation={[seated ? Math.PI / 2 : 0, 0, 0]}>
              <mesh position={[0, -D.SHIN / 2, 0]} castShadow>
                <capsuleGeometry args={[0.055, D.SHIN - 0.08, 6, 14]} />
                <meshStandardMaterial color={look.pants} roughness={0.85} />
              </mesh>
              <mesh position={[0, -D.SHIN - 0.035, 0.05]} castShadow>
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
