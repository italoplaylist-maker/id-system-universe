"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PALETTE } from "../palette";
import { OFFICE, type OfficeLayout } from "./office-layout";
import { useCameraStore } from "@/store/camera-store";
import { useTexture } from "@react-three/drei";
import { useUiStore } from "@/store/ui-store";
import { QUALITY_PROFILES } from "../render/quality";
import { HQ } from "../plan/hq-plan";

const WALL_COLOR = "#d6d9e0";
const TRIM = "#5b6372";

function makeFloorTexture(width: number, depth: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const plankW = 64;
  const tones = ["#8a6544", "#946d49", "#805c3d", "#99734e", "#8d6846"];
  for (let i = 0; i < 8; i += 1) {
    // staggered planks (running along x), two joints per plank row
    const y = i * plankW;
    const offset = (i * 173) % 512;
    for (let seg = 0; seg < 2; seg += 1) {
      const x0 = (offset + seg * 256) % 512;
      ctx.fillStyle = tones[(i * 3 + seg * 2) % tones.length];
      ctx.fillRect(x0, y, 256, plankW);
      if (x0 + 256 > 512) ctx.fillRect(x0 - 512, y, 256, plankW);
      // grain
      ctx.strokeStyle = "rgba(0,0,0,0.07)";
      for (let g = 0; g < 5; g += 1) {
        ctx.beginPath();
        ctx.moveTo(x0, y + 8 + g * 11);
        ctx.lineTo(x0 + 256, y + 10 + g * 11);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, y, 512, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width / 4, depth / 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Piso de madeira real: Poly Haven "Laminate Floor 02" (CC0), 1k — cor, normal e ARM (rugosidade no canal G).
 * Texturas clonadas por sala (repetição diferente) compartilhando a mesma imagem na GPU.
 */
function HavenFloor({ width, depth }: { width: number; depth: number }) {
  const [diff, nor, arm] = useTexture([
    "/textures/floor/laminate_floor_02_diff_1k.jpg",
    "/textures/floor/laminate_floor_02_nor_gl_1k.jpg",
    "/textures/floor/laminate_floor_02_arm_1k.jpg",
  ]);
  const maps = useMemo(() => {
    const make = (t: THREE.Texture, srgb: boolean) => {
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(width / 2.4, depth / 2.4);
      c.anisotropy = 8;
      c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      c.needsUpdate = true;
      return c;
    };
    return { diff: make(diff, true), nor: make(nor, false), arm: make(arm, false) };
  }, [diff, nor, arm, width, depth]);
  useEffect(
    () => () => {
      maps.diff.dispose();
      maps.nor.dispose();
      maps.arm.dispose();
    },
    [maps],
  );
  return (
    <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial map={maps.diff} normalMap={maps.nor} normalScale={new THREE.Vector2(0.8, 0.8)} roughnessMap={maps.arm} roughness={1} metalness={0} envMapIntensity={0.9} />
    </mesh>
  );
}

/** Wall that stays 100% solid in Overview and fades out (without writing depth) only when the free camera ends up behind it. */
function FadingWall({ outward, position, args, color }: { outward: [number, number, number]; position: [number, number, number]; args: [number, number, number]; color: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const worldPos = useRef(new THREE.Vector3());
  const toCamera = useRef(new THREE.Vector3());

  useFrame(({ camera }) => {
    const material = materialRef.current;
    const mesh = meshRef.current;
    if (!material || !mesh) return;
    if (useCameraStore.getState().mode === "overview") {
      material.opacity += (1 - material.opacity) * 0.2;
      material.depthWrite = true;
      return;
    }
    mesh.getWorldPosition(worldPos.current);
    toCamera.current.copy(camera.position).sub(worldPos.current);
    const facing = toCamera.current.x * outward[0] + toCamera.current.y * outward[1] + toCamera.current.z * outward[2];
    material.opacity += ((facing > 0 ? 0.1 : 1) - material.opacity) * 0.15;
    material.depthWrite = material.opacity > 0.5;
  });

  return (
    <mesh ref={meshRef} position={position} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial ref={materialRef} color={color} roughness={0.85} metalness={0.02} transparent />
    </mesh>
  );
}

/** Floor-to-ceiling glass with slim steel mullions — you see the whole office through it. */
function GlassWall({ length, height, mullions, gap }: { length: number; height: number; mullions: number; gap?: { center: number; width: number } }) {
  const step = length / mullions;
  const inGap = (x: number) => !!gap && Math.abs(x - gap.center) < gap.width / 2 + 0.03;
  // Rails run the full length except across the doorway.
  const segments = (y: number, thickness: number, depthZ: number) => {
    const spans: Array<[number, number]> = gap
      ? [[-length / 2, gap.center - gap.width / 2], [gap.center + gap.width / 2, length / 2]]
      : [[-length / 2, length / 2]];
    return spans.filter(([a, b]) => b - a > 0.01).map(([a, b]) => (
      <mesh key={`${y}-${a}`} position={[(a + b) / 2, y, 0]}>
        <boxGeometry args={[b - a, thickness, depthZ]} />
        <meshStandardMaterial color={TRIM} metalness={0.7} roughness={0.35} />
      </mesh>
    ));
  };
  return (
    <group>
      <mesh position={[0, height / 2, 0]}>
        <planeGeometry args={[length, height]} />
        <meshPhysicalMaterial color="#cfe6ff" transparent opacity={0.12} roughness={0.04} metalness={0.1} ior={1.5} reflectivity={0.6} clearcoat={1} clearcoatRoughness={0.05} envMapIntensity={1.4} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: mullions + 1 }).map((_, i) => {
        const x = -length / 2 + i * step;
        if (inGap(x)) return null;
        return (
          <mesh key={i} position={[x, height / 2, 0]} castShadow>
            <boxGeometry args={[0.045, height, 0.045]} />
            <meshStandardMaterial color={TRIM} metalness={0.7} roughness={0.35} />
          </mesh>
        );
      })}
      {segments(0.05, 0.06, 0.06)}
      {segments(height - 0.04, 0.06, 0.06)}
      {segments(1.05, 0.04, 0.045)}
    </group>
  );
}

/** Steel door frame in the partition, with a glass leaf left slightly ajar toward the agents room. */
function PartitionDoor({ x, width }: { x: number; width: number }) {
  const H = 2.3;
  return (
    <group position={[x, 0, 0]}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * width) / 2, H / 2, 0]} castShadow>
          <boxGeometry args={[0.08, H, 0.14]} />
          <meshStandardMaterial color={TRIM} metalness={0.75} roughness={0.35} />
        </mesh>
      ))}
      <mesh position={[0, H + 0.04, 0]} castShadow>
        <boxGeometry args={[width + 0.16, 0.1, 0.14]} />
        <meshStandardMaterial color={TRIM} metalness={0.75} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.01, 0]}>
        <boxGeometry args={[width, 0.02, 0.16]} />
        <meshStandardMaterial color="#2a303c" roughness={0.8} />
      </mesh>
      {/* leaf, hinged on the -x post, opened ~65° toward +z (the agents room) */}
      <group position={[-width / 2 + 0.04, 0, 0]} rotation={[0, -1.15, 0]}>
        <mesh position={[(width - 0.08) / 2, H / 2, 0]}>
          <boxGeometry args={[width - 0.08, H - 0.04, 0.035]} />
          <meshStandardMaterial color="#cfe6ff" transparent opacity={0.28} roughness={0.08} metalness={0.3} depthWrite={false} />
        </mesh>
        {[0, 1].map((k) => (
          <mesh key={k} position={[k === 0 ? 0.03 : width - 0.1, H / 2, 0]}>
            <boxGeometry args={[0.06, H - 0.04, 0.05]} />
            <meshStandardMaterial color={TRIM} metalness={0.7} roughness={0.4} />
          </mesh>
        ))}
        <mesh position={[width - 0.2, 1.0, 0.04]}>
          <boxGeometry args={[0.03, 0.03, 0.08]} />
          <meshStandardMaterial color="#c9ced8" metalness={0.9} roughness={0.25} />
        </mesh>
      </group>
    </group>
  );
}

export const PARTITION_DOOR_WIDTH = 1.15;

/** z (world, in the main room's frame) of the doorway in the east partition. */
export function partitionDoorZ(depth: number): number {
  return depth / 2 - 1.9;
}

/** Face externa da parede de fundo: ripado de madeira natural em painéis alternados com concreto, friso grafite e letreiro de LED. */
/** Letreiro vertical "ID SYSTEM" (texto girado 90°) para a face lateral dos volumes salientes. */
function useBladeSign(): THREE.MeshBasicMaterial {
  const mat = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 768;
    const g = c.getContext("2d")!;
    g.translate(80, 384);
    g.rotate(-Math.PI / 2);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "800 92px ui-sans-serif, system-ui";
    g.fillStyle = "#f4f6fa";
    g.fillText("ID", -150, 0);
    g.fillStyle = "#e8283f";
    g.fillText("SYSTEM", 130, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthWrite: false });
  }, []);
  useEffect(
    () => () => {
      mat.map?.dispose();
      mat.dispose();
    },
    [mat],
  );
  return mat;
}

function Cladding({ width, height, backZ, T, tower }: { width: number; height: number; backZ: number; T: number; tower?: { side: -1 | 1; extra: number } }) {
  const z = backZ - T / 2 - 0.035;
  const bladeMat = useBladeSign();
  const slats = Math.round((width * 0.46) / 0.11);
  const panelW = slats * 0.11;
  return (
    <group>
      {/* friso grafite no topo */}
      <mesh position={[0, height - 0.28, z - 0.02]} castShadow>
        <boxGeometry args={[width + T + 0.2, 0.56, 0.1]} />
        <meshStandardMaterial color="#262b33" metalness={0.8} roughness={0.38} envMapIntensity={0.9} />
      </mesh>
      <mesh position={[0, height - 0.6, z - 0.01]}>
        <boxGeometry args={[width + T, 0.03, 0.04]} />
        <meshStandardMaterial color={PALETTE.brand} emissive={PALETTE.brand} emissiveIntensity={1} toneMapped={false} />
      </mesh>
      {/* painel de ripas de madeira, deslocado do centro (composição assimétrica) */}
      <group position={[-width * 0.16, 0, z]}>
        {Array.from({ length: slats }).map((_, i) => (
          <mesh key={i} position={[-panelW / 2 + 0.055 + i * 0.11, (height - 0.7) / 2, 0]} castShadow>
            <boxGeometry args={[0.07, height - 0.7, 0.05]} />
            <meshStandardMaterial color={i % 6 === 3 ? "#6d4c34" : i % 4 === 1 ? "#85603f" : "#7a5639"} roughness={0.72} />
          </mesh>
        ))}
      </group>
      {/* volume saliente atrás da parede de fundo (núcleo de circulação): quebra a silhueta de caixa */}
      {tower && (
        <group position={[tower.side * (width / 2 - 1.5), 0, backZ - T / 2 - 1.25]}>
          <mesh position={[0, (height + tower.extra) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.6, height + tower.extra, 2.4]} />
            <meshStandardMaterial color="#3b3f47" roughness={0.9} />
          </mesh>
          <mesh position={[0, (height + tower.extra) / 2, 1.215]}>
            <boxGeometry args={[0.3, height + tower.extra - 0.8, 0.03]} />
            <meshStandardMaterial color="#ffd9a0" emissive="#ffb86b" emissiveIntensity={0.9} toneMapped={false} />
          </mesh>
          <mesh position={[1.31, (height + tower.extra) / 2, 0.6]}>
            <boxGeometry args={[0.03, height + tower.extra, 0.1]} />
            <meshStandardMaterial color={PALETTE.brand} emissive={PALETTE.brand} emissiveIntensity={1} toneMapped={false} />
          </mesh>
          {/* letreiro vertical nas duas faces laterais do volume */}
          {[-1, 1].map((sd) => (
            <mesh key={sd} position={[sd * 1.325, (height + tower.extra) / 2 + 0.2, -0.25]} rotation={[0, (sd * Math.PI) / 2, 0]} material={bladeMat}>
              <planeGeometry args={[0.55, 2.64]} />
            </mesh>
          ))}
          <mesh position={[0, height + tower.extra + 0.05, 0]}>
            <boxGeometry args={[2.8, 0.1, 2.6]} />
            <meshStandardMaterial color="#262b33" metalness={0.8} roughness={0.38} />
          </mesh>
        </group>
      )}
      {/* base de concreto aparente */}
      <mesh position={[0, 0.32, z + 0.005]}>
        <boxGeometry args={[width + T, 0.64, 0.05]} />
        <meshStandardMaterial color="#6f737b" roughness={0.9} />
      </mesh>
    </group>
  );
}

export interface OfficeShellProps {
  layout: OfficeLayout;
  nocEnabled?: boolean;
  westWall?: "windows" | "none";
  /** Lado da parede de vidro com a porta para o átrio. */
  doorSide?: "east" | "west" | "none";
  /** z LOCAL do centro da porta (padrão: o da sala original). */
  doorZ?: number;
  screenPanel?: boolean;
  wallHeight?: number;
  /** Cor da face opaca (parede de fundo). */
  tint?: string;
  /** Revestimento externo: ripado de madeira e friso de aço grafite na parede de fundo. */
  cladding?: boolean;
  /** Volume saliente atrás da parede de fundo: lado (−1 oeste, +1 leste) e quanto passa da altura da ala. */
  tower?: { side: -1 | 1; extra: number };
}

export function OfficeShell({ layout, nocEnabled = false, westWall = "windows", doorSide = "none", doorZ, screenPanel = true, wallHeight, tint = WALL_COLOR, cladding = true, tower }: OfficeShellProps) {
  const { width, depth } = layout;
  const H = wallHeight ?? OFFICE.WALL_HEIGHT;
  const doorAt = doorZ ?? partitionDoorZ(depth);
  const T = OFFICE.WALL_THICKNESS;
  const backZ = -depth / 2;
  const floorTexture = useMemo(() => makeFloorTexture(width, depth), [width, depth]);
  useEffect(() => () => floorTexture.dispose(), [floorTexture]);
  const rich = QUALITY_PROFILES[useUiStore((s) => s.quality)].richMaterials;
  // With the NOC wall, windows only cover the rest of the west wall (from the end of the NOC panel to the front).
  const winStart = nocEnabled ? layout.noc.z1 + 0.15 : -depth / 2;
  const winEnd = depth / 2;
  const winLen = winEnd - winStart;
  const winCenter = (winStart + winEnd) / 2;
  const windowCount = Math.max(1, Math.round(winLen / 4.2));
  const windowStep = (winLen - 1.2) / windowCount;

  return (
    <group>
      {/* foundation plinth + polished floor + front lip */}
      <mesh position={[0, -0.14, 0]} receiveShadow>
        <boxGeometry args={[width + 0.5, 0.28, depth + 0.5]} />
        <meshStandardMaterial color="#cfd2d9" roughness={0.9} />
      </mesh>
      <Suspense
        fallback={
          <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[width, depth]} />
            <meshStandardMaterial map={floorTexture} roughness={0.38} metalness={0.05} />
          </mesh>
        }
      >
        {rich ? (
          <HavenFloor width={width} depth={depth} />
        ) : (
          <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[width, depth]} />
            <meshStandardMaterial map={floorTexture} roughness={0.38} metalness={0.05} />
          </mesh>
        )}
      </Suspense>
      <mesh position={[0, 0.02, depth / 2 + 0.05]}>
        <boxGeometry args={[width + 0.5, 0.05, 0.1]} />
        <meshStandardMaterial color={PALETTE.brand} emissive={PALETTE.brand} emissiveIntensity={0.7} />
      </mesh>
      {/* entrance steps */}
      {[0, 1].map((i) => (
        <mesh key={i} position={[0, -0.05 - i * 0.14 + 0.1, depth / 2 + 0.55 + i * 0.4]} receiveShadow>
          <boxGeometry args={[3.2, 0.14, 0.7]} />
          <meshStandardMaterial color="#c4c7ce" roughness={0.9} />
        </mesh>
      ))}

      {/* back wall + slat acoustic panel behind the screen */}
      <FadingWall outward={[0, 0, -1]} position={[0, H / 2, backZ]} args={[width + T, H, T]} color={tint} />
      {screenPanel && (
        <>
      <mesh position={[0, layout.screen.y, backZ + T / 2 + 0.03]} receiveShadow>
        <boxGeometry args={[layout.screen.width + 1.0, layout.screen.height + 0.9, 0.04]} />
        <meshStandardMaterial color="#3a2a20" roughness={0.8} />
      </mesh>
      {Array.from({ length: Math.round((layout.screen.width + 1.0) / 0.12) }).map((_, i) => (
        <mesh key={i} position={[-(layout.screen.width + 1.0) / 2 + 0.06 + i * 0.12, layout.screen.y, backZ + T / 2 + 0.065]}>
          <boxGeometry args={[0.06, layout.screen.height + 0.9, 0.03]} />
          <meshStandardMaterial color={i % 5 === 2 ? "#6d4c34" : "#7a5639"} roughness={0.7} />
        </mesh>
      ))}
        </>
      )}
      <mesh position={[0, H - 0.22, backZ + T / 2 + 0.03]}>
        <boxGeometry args={[width - 0.4, 0.045, 0.03]} />
        <meshStandardMaterial color={PALETTE.brand} emissive={PALETTE.brand} emissiveIntensity={0.9} />
      </mesh>

      {/* west wall: solid base, tall window band with blinds, solid header (absent when it is the shared partition) */}
      {westWall === "windows" && doorSide !== "west" && <group position={[-width / 2, 0, 0]}>
        <FadingWall outward={[-1, 0, 0]} position={[0, 0.5, 0]} args={[T, 1.0, depth + T]} color={WALL_COLOR} />
        <FadingWall outward={[-1, 0, 0]} position={[0, H - 0.25, 0]} args={[T, 0.5, depth + T]} color={WALL_COLOR} />
        <mesh position={[0.02, 2.15, winCenter]}>
          <planeGeometry args={[winLen, 2.4]} />
          <meshStandardMaterial color="#bcd7ff" transparent opacity={0.16} roughness={0.08} metalness={0.2} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        {Array.from({ length: windowCount + 1 }).map((_, i) => (
          <mesh key={i} position={[0.04, 2.15, winStart + 0.6 + i * windowStep]} castShadow>
            <boxGeometry args={[0.1, 2.4, 0.07]} />
            <meshStandardMaterial color={TRIM} metalness={0.7} roughness={0.4} />
          </mesh>
        ))}
        {/* horizontal blinds: slats parallel to the window, lowered a different amount in each bay */}
        {Array.from({ length: windowCount }).map((_, i) => {
          const slats = 24;
          const lowered = 6 + ((i * 7) % 8);
          const bayCenter = winStart + 0.6 + (i + 0.5) * windowStep;
          return (
            <group key={i} position={[0.1, 3.35, bayCenter]}>
              {Array.from({ length: lowered }).map((__, k) => (
                <mesh key={k} position={[0, -0.11 - k * (2.4 / slats), 0]}>
                  <boxGeometry args={[0.02, 2.4 / slats - 0.03, windowStep - 0.16]} />
                  <meshStandardMaterial color="#d3d8e2" roughness={0.55} />
                </mesh>
              ))}
            </group>
          );
        })}
      </group>}

      {/* east wall: full glass (with the door to the atrium when doorSide = east) */}
      <group position={[width / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <GlassWall
          length={depth}
          height={H}
          mullions={Math.max(4, Math.round(depth / 2.4))}
          gap={doorSide === "east" ? { center: -doorAt, width: HQ.DOOR_WIDTH } : undefined}
        />
        {doorSide === "east" && <PartitionDoor x={-doorAt} width={HQ.DOOR_WIDTH} />}
      </group>
      {/* west wall as glass + door (lounge: the atrium is on its west side) */}
      {doorSide === "west" && (
        <group position={[-width / 2, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <GlassWall length={depth} height={H} mullions={Math.max(4, Math.round(depth / 2.4))} gap={{ center: doorAt, width: HQ.DOOR_WIDTH }} />
          <PartitionDoor x={doorAt} width={HQ.DOOR_WIDTH} />
        </group>
      )}
      {cladding && <Cladding width={width} height={H} backZ={backZ} T={T} tower={tower} />}

      {/* baseboards */}
      <mesh position={[0, 0.07, backZ + T / 2 + 0.02]}>
        <boxGeometry args={[width - 0.2, 0.14, 0.03]} />
        <meshStandardMaterial color={TRIM} roughness={0.6} />
      </mesh>
      {westWall === "windows" && doorSide !== "west" && (
        <mesh position={[-width / 2 + T / 2 + 0.02, 0.07, 0]}>
          <boxGeometry args={[0.03, 0.14, depth - 0.2]} />
          <meshStandardMaterial color={TRIM} roughness={0.6} />
        </mesh>
      )}

      {/* slim steel top frame — no ceiling (architectural cutaway), nothing hanging between the camera and the desks */}
      <mesh position={[0, H + 0.03, backZ]}>
        <boxGeometry args={[width + 0.3, 0.08, 0.2]} />
        <meshStandardMaterial color={TRIM} metalness={0.75} roughness={0.35} />
      </mesh>
      {[-width / 2, width / 2].map((x) => (
        <mesh key={x} position={[x, H + 0.03, 0]}>
          <boxGeometry args={[0.2, 0.08, depth + 0.3]} />
          <meshStandardMaterial color={TRIM} metalness={0.75} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}
