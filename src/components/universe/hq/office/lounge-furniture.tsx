"use client";

import { useUiStore } from "@/store/ui-store";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { PALETTE } from "../palette";
import { TallPlant } from "./office-props";
import type { LoungeLayout } from "../life/lounge-layout";
import type { LifeSim } from "../life/sim";
import { POCKETS, POOL, PoolGame } from "../life/pool-game";

const WALNUT = "#6b4a32";
const WALNUT_DARK = "#4a3224";
const BRASS = "#c9a25b";
const LEATHER = "#2d2622";
const FELT = "#1f6b4a";


/** Muitas peças iguais (ripas) num só draw call, cada uma com a sua cor. */
function InstancedBoxes({ size, items }: { size: [number, number, number]; items: Array<{ p: [number, number, number]; c: string }> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.set(it.c));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [items]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]}>
      <boxGeometry args={size} />
      <meshStandardMaterial roughness={0.7} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// Mesa de sinuca
// ---------------------------------------------------------------------------

const BALL_R = POOL.BALL_R;
const TABLE_TOP = 0.82;
const PLAY_L = POOL.PLAY_L;
const PLAY_W = POOL.PLAY_W;
/** Cores das bolas 1–15 (cheias e listradas aproximadas por cor sólida) + branca. */
const BALL_COLORS = ["#f5f5f0", "#f2c230", "#2f5fd0", "#d83a2e", "#5a2a86", "#ee7a22", "#1f7a3d", "#8c2a2a", "#1a1a1a", "#f2c230", "#2f5fd0", "#d83a2e", "#5a2a86", "#ee7a22", "#1f7a3d", "#8c2a2a"];

/** Bolas num único InstancedMesh: as posições vêm da simulação (PoolGame) — o desenho só reescreve quando algo mudou. */
function PoolBalls({ life }: { life?: LifeSim }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const fallback = useMemo(() => new PoolGame(), []);
  const game = life?.poolGame ?? fallback;
  const seen = useRef(-1);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    BALL_COLORS.forEach((c, i) => m.setColorAt(i, color.set(c)));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    seen.current = -1;
  }, [color]);

  useFrame(() => {
    const m = mesh.current;
    if (!m || seen.current === game.version) return;
    seen.current = game.version;
    for (let i = 0; i < 16; i += 1) {
      tmp.position.set(game.pos[i * 2], BALL_R, game.pos[i * 2 + 1]);
      tmp.scale.setScalar(game.alive[i] ? 1 : 0);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 16]} castShadow>
      <sphereGeometry args={[BALL_R, 16, 12]} />
      <meshStandardMaterial roughness={0.18} metalness={0.05} />
    </instancedMesh>
  );
}

function PoolTable({ x, z, life }: { x: number; z: number; life?: LifeSim }) {
  const railW = 0.24;
  const outerL = PLAY_L + railW * 2;
  const outerW = PLAY_W + railW * 2;
  return (
    <group position={[x, 0, z]}>
      {/* pernas e avental */}
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
        <mesh key={`${sx}${sz}`} position={[sx * (outerL / 2 - 0.2), 0.36, sz * (outerW / 2 - 0.2)]} castShadow>
          <boxGeometry args={[0.2, 0.72, 0.2]} />
          <meshStandardMaterial color={WALNUT_DARK} roughness={0.55} />
        </mesh>
      )))}
      <RoundedBox args={[outerL, 0.22, outerW]} radius={0.03} smoothness={3} position={[0, TABLE_TOP - 0.19, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={WALNUT} roughness={0.45} />
      </RoundedBox>
      {/* trilhos de madeira */}
      {[
        { p: [0, TABLE_TOP - 0.04, outerW / 2 - railW / 2], s: [outerL, 0.12, railW] },
        { p: [0, TABLE_TOP - 0.04, -outerW / 2 + railW / 2], s: [outerL, 0.12, railW] },
        { p: [outerL / 2 - railW / 2, TABLE_TOP - 0.04, 0], s: [railW, 0.12, outerW - railW * 2] },
        { p: [-outerL / 2 + railW / 2, TABLE_TOP - 0.04, 0], s: [railW, 0.12, outerW - railW * 2] },
      ].map((r, i) => (
        <RoundedBox key={i} args={r.s as [number, number, number]} radius={0.025} smoothness={3} position={r.p as [number, number, number]} castShadow>
          <meshStandardMaterial color={WALNUT} roughness={0.4} />
        </RoundedBox>
      ))}
      {/* pano e tabelas */}
      <mesh position={[0, TABLE_TOP - 0.02, 0]} receiveShadow>
        <boxGeometry args={[PLAY_L, 0.04, PLAY_W]} />
        <meshStandardMaterial color={FELT} roughness={0.95} />
      </mesh>
      {[
        { p: [0, TABLE_TOP + 0.005, PLAY_W / 2 + 0.015], s: [PLAY_L, 0.05, 0.05] },
        { p: [0, TABLE_TOP + 0.005, -PLAY_W / 2 - 0.015], s: [PLAY_L, 0.05, 0.05] },
        { p: [PLAY_L / 2 + 0.015, TABLE_TOP + 0.005, 0], s: [0.05, 0.05, PLAY_W] },
        { p: [-PLAY_L / 2 - 0.015, TABLE_TOP + 0.005, 0], s: [0.05, 0.05, PLAY_W] },
      ].map((c, i) => (
        <mesh key={i} position={c.p as [number, number, number]}>
          <boxGeometry args={c.s as [number, number, number]} />
          <meshStandardMaterial color="#17533a" roughness={0.9} />
        </mesh>
      ))}
      {/* caçapas */}
      {POCKETS.map((p, i) => (
        <mesh key={i} position={[p[0] * 1.015, TABLE_TOP + 0.002, p[1] * 1.03]}>
          <cylinderGeometry args={[0.055, 0.055, 0.03, 16]} />
          <meshStandardMaterial color="#0a0a0c" roughness={0.9} />
        </mesh>
      ))}
      {/* pontos de mira */}
      {[-0.55, -0.27, 0.27, 0.55].map((u) => [-1, 1].map((s) => (
        <mesh key={`${u}${s}`} position={[u * PLAY_L * 0.9, TABLE_TOP + 0.032, s * (PLAY_W / 2 + railW / 2)]}>
          <cylinderGeometry args={[0.009, 0.009, 0.004, 8]} />
          <meshStandardMaterial color={BRASS} metalness={0.8} roughness={0.3} />
        </mesh>
      )))}
      <group position={[0, TABLE_TOP, 0]}>
        <PoolBalls life={life} />
      </group>
      {/* luminária sobre a mesa */}
      <group position={[0, 2.35, 0]}>
        <mesh>
          <boxGeometry args={[1.9, 0.07, 0.34]} />
          <meshStandardMaterial color="#14161b" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh position={[0, -0.045, 0]}>
          <boxGeometry args={[1.8, 0.012, 0.26]} />
          <meshStandardMaterial color="#fff0d6" emissive="#ffd9a0" emissiveIntensity={1.6} />
        </mesh>
        {[-0.8, 0.8].map((cx) => (
          <mesh key={cx} position={[cx, 0.7, 0]}>
            <cylinderGeometry args={[0.006, 0.006, 1.4, 6]} />
            <meshStandardMaterial color="#222" />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

function BarStool({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.22, 0.03, 20]} />
        <meshStandardMaterial color="#1a1c21" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.34, 0]} castShadow>
        <cylinderGeometry args={[0.028, 0.028, 0.66, 10]} />
        <meshStandardMaterial color="#b9bec8" metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.16, 0.012, 8, 24]} />
        <meshStandardMaterial color="#b9bec8" metalness={0.9} roughness={0.2} />
      </mesh>
      <RoundedBox args={[0.38, 0.07, 0.38]} radius={0.032} smoothness={3} position={[0, 0.69, 0]} castShadow>
        <meshStandardMaterial color={LEATHER} roughness={0.55} />
      </RoundedBox>
    </group>
  );
}

function Bottles({ x, z, length }: { x: number; z: number; length: number }) {
  const body = useRef<THREE.InstancedMesh>(null);
  const neck = useRef<THREE.InstancedMesh>(null);
  const shelves = [0.98, 1.46, 1.94];
  const count = Math.floor((length - 0.4) / 0.17);
  const total = shelves.length * count;
  useEffect(() => {
    const b = body.current;
    const n = neck.current;
    if (!b || !n) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    const palette = ["#3b6b3a", "#8b4a1f", "#a63a2b", "#2a4c7a", "#c9a25b", "#d8d8cf", "#5b2a6a", "#1f1f23"];
    let i = 0;
    shelves.forEach((y, si) => {
      for (let k = 0; k < count; k += 1) {
        const hash = (k * 7 + si * 13) % 11;
        if (hash === 0) continue; // vão na prateleira
        const h = 0.2 + (hash % 4) * 0.022;
        o.position.set(0, y + h / 2, -length / 2 + 0.3 + k * 0.17);
        o.scale.set(1, h / 0.24, 1);
        o.updateMatrix();
        b.setMatrixAt(i, o.matrix);
        b.setColorAt(i, c.set(palette[(k * 3 + si * 5 + hash) % palette.length]));
        o.position.set(0, y + h + 0.045, -length / 2 + 0.3 + k * 0.17);
        o.scale.set(1, 1, 1);
        o.updateMatrix();
        n.setMatrixAt(i, o.matrix);
        i += 1;
      }
    });
    b.count = i;
    n.count = i;
    b.instanceMatrix.needsUpdate = true;
    n.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- constantes derivadas de length
  }, [length]);
  return (
    <group position={[x, 0, z]}>
      <instancedMesh ref={body} args={[undefined, undefined, total]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.24, 12]} />
        <meshStandardMaterial roughness={0.2} metalness={0.1} transparent opacity={0.92} />
      </instancedMesh>
      <instancedMesh ref={neck} args={[undefined, undefined, total]}>
        <cylinderGeometry args={[0.014, 0.02, 0.09, 8]} />
        <meshStandardMaterial color="#2a2a2e" roughness={0.3} metalness={0.2} />
      </instancedMesh>
    </group>
  );
}

function Bar({ layout, life }: { layout: LoungeLayout; life?: LifeSim }) {
  const { bar, backBar, stools } = layout.furniture;
  const glassesRef = useRef<THREE.InstancedMesh>(null);
  const counterSlats = useMemo(
    () => Array.from({ length: Math.floor(bar.length / 0.14) }).map((_, i) => ({ p: [-bar.depth / 2 + 0.085, 0.5, -bar.length / 2 + 0.1 + i * 0.14] as [number, number, number], c: i % 4 === 0 ? "#7d5a3d" : WALNUT })),
    [bar.length, bar.depth],
  );
  const glassObj = useMemo(() => new THREE.Object3D(), []);
  const lastMask = useRef(-1);
  // Um copo no balcão diante de cada banqueta OCUPADA; some da mesa enquanto está na mão de quem bebe.
  useFrame(() => {
    const g = glassesRef.current;
    if (!g) return;
    let mask = 0;
    if (life) {
      for (const a of life.actors.values()) {
        if (a.phase !== "seated" || a.seat?.kind !== "stool") continue;
        const idx = Number(a.seat.id.split("-")[1]);
        if (Number.isInteger(idx) && a.vis.drink < 0.04 && a.vis.sit > 0.95) mask |= 1 << idx;
      }
    }
    if (mask === lastMask.current) return;
    lastMask.current = mask;
    stools.forEach((p, i) => {
      glassObj.position.set(-0.2, 1.1, p.z - bar.z);
      glassObj.scale.setScalar(mask & (1 << i) ? 1 : 0);
      glassObj.updateMatrix();
      g.setMatrixAt(i, glassObj.matrix);
    });
    g.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      {/* balcão: corpo ripado + tampo de pedra + LED sob a borda */}
      <group position={[bar.x, 0, bar.z]}>
        <RoundedBox args={[bar.depth - 0.1, 1.02, bar.length]} radius={0.02} smoothness={2} position={[0.02, 0.51, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={WALNUT_DARK} roughness={0.6} />
        </RoundedBox>
        <InstancedBoxes size={[0.03, 0.94, 0.07]} items={counterSlats} />
        <RoundedBox args={[bar.depth + 0.12, 0.05, bar.length + 0.06]} radius={0.015} smoothness={3} position={[-0.04, 1.045, 0]} castShadow>
          <meshStandardMaterial color="#e8e4dc" roughness={0.22} metalness={0.05} />
        </RoundedBox>
        <mesh position={[-bar.depth / 2 + 0.01, 0.07, 0]}>
          <boxGeometry args={[0.02, 0.025, bar.length - 0.1]} />
          <meshStandardMaterial color="#ffb877" emissive="#ff9a4d" emissiveIntensity={1.7} />
        </mesh>
        {/* apoio de pés em latão */}
        <mesh position={[-bar.depth / 2 - 0.12, 0.26, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.022, 0.022, bar.length - 0.1, 10]} />
          <meshStandardMaterial color={BRASS} metalness={0.9} roughness={0.25} />
        </mesh>
        <instancedMesh ref={glassesRef} args={[undefined, undefined, Math.max(1, stools.length)]}>
          <cylinderGeometry args={[0.034, 0.028, 0.1, 12]} />
          <meshStandardMaterial color="#d8ecff" transparent opacity={0.5} roughness={0.08} />
        </instancedMesh>
      </group>

      {/* estante de fundo: caixa aberta (moldura + fundo de vidro fumê), prateleiras de vidro com LED e garrafas — visível dos dois lados */}
      <group position={[backBar.x, 0, backBar.z]}>
        {/* base fechada (armário) */}
        <RoundedBox args={[0.5, 0.94, backBar.length + 0.1]} radius={0.02} smoothness={2} position={[0, 0.47, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#1d2026" roughness={0.65} />
        </RoundedBox>
        {/* moldura: topo e laterais */}
        <mesh position={[0, 2.2, 0]}>
          <boxGeometry args={[0.5, 0.06, backBar.length + 0.1]} />
          <meshStandardMaterial color="#16181d" roughness={0.6} />
        </mesh>
        {[-1, 1].map((e) => (
          <mesh key={e} position={[0, 1.57, (e * (backBar.length + 0.1)) / 2]}>
            <boxGeometry args={[0.5, 1.26, 0.06]} />
            <meshStandardMaterial color="#16181d" roughness={0.6} />
          </mesh>
        ))}
        {/* fundo de vidro fumê (deixa ver as garrafas da câmera) */}
        <mesh position={[0.22, 1.57, 0]}>
          <boxGeometry args={[0.02, 1.26, backBar.length]} />
          <meshStandardMaterial color="#aeb9cc" transparent opacity={0.28} roughness={0.05} metalness={0.4} depthWrite={false} />
        </mesh>
        {[0.95, 1.43, 1.91].map((y) => (
          <group key={y}>
            <mesh position={[0, y, 0]}>
              <boxGeometry args={[0.38, 0.025, backBar.length - 0.1]} />
              <meshStandardMaterial color="#cfe6ff" transparent opacity={0.4} roughness={0.05} />
            </mesh>
            <mesh position={[-0.17, y + 0.016, 0]}>
              <boxGeometry args={[0.018, 0.012, backBar.length - 0.2]} />
              <meshStandardMaterial color="#ffd9a0" emissive="#ffc880" emissiveIntensity={2.4} />
            </mesh>
          </group>
        ))}
        <Bottles x={0} z={0} length={backBar.length} />
      </group>

      {stools.map((p, i) => (
        <BarStool key={i} x={p.x} z={p.z} />
      ))}
      {/* luminárias penduradas sobre o balcão */}
      {[-0.32, 0, 0.32].map((k) => (
        <group key={k} position={[bar.x - 0.3, 0, bar.z + k * bar.length]}>
          <mesh position={[0, 3.0, 0]}>
            <cylinderGeometry args={[0.004, 0.004, 1.0, 6]} />
            <meshStandardMaterial color="#222" />
          </mesh>
          <mesh position={[0, 2.5, 0]}>
            <sphereGeometry args={[0.13, 18, 14]} />
            <meshStandardMaterial color="#ffe3b8" emissive="#ffc27a" emissiveIntensity={1.8} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Sofás, poltronas, mesa de centro, tapete
// ---------------------------------------------------------------------------

function Sofa({ x, z, yaw, length, color }: { x: number; z: number; yaw: number; length: number; color: string }) {
  const seats = Math.max(1, Math.round(length / 0.9));
  const seatW = (length - 0.3) / seats;
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <RoundedBox args={[length, 0.28, 0.98]} radius={0.06} smoothness={4} position={[0, 0.25, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.95} />
      </RoundedBox>
      {Array.from({ length: seats }).map((_, i) => (
        <RoundedBox key={i} args={[seatW - 0.02, 0.15, 0.78]} radius={0.06} smoothness={4} position={[-length / 2 + 0.15 + seatW * (i + 0.5), 0.46, 0.06]} castShadow>
          <meshStandardMaterial color={color} roughness={0.98} />
        </RoundedBox>
      ))}
      {Array.from({ length: seats }).map((_, i) => (
        <RoundedBox key={i} args={[seatW - 0.04, 0.46, 0.2]} radius={0.07} smoothness={4} position={[-length / 2 + 0.15 + seatW * (i + 0.5), 0.78, -0.33]} rotation={[-0.14, 0, 0]} castShadow>
          <meshStandardMaterial color={color} roughness={0.98} />
        </RoundedBox>
      ))}
      {[-1, 1].map((s) => (
        <RoundedBox key={s} args={[0.17, 0.46, 0.98]} radius={0.07} smoothness={4} position={[s * (length / 2 - 0.085), 0.52, 0]} castShadow>
          <meshStandardMaterial color={color} roughness={0.95} />
        </RoundedBox>
      ))}
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
        <mesh key={`${sx}${sz}`} position={[sx * (length / 2 - 0.12), 0.05, sz * 0.38]}>
          <cylinderGeometry args={[0.025, 0.018, 0.1, 8]} />
          <meshStandardMaterial color={BRASS} metalness={0.85} roughness={0.3} />
        </mesh>
      )))}
      {/* almofadas */}
      <RoundedBox args={[0.34, 0.34, 0.1]} radius={0.04} smoothness={3} position={[-length / 2 + 0.45, 0.68, -0.1]} rotation={[-0.3, 0.3, 0.1]}>
        <meshStandardMaterial color={PALETTE.brand} roughness={0.9} />
      </RoundedBox>
      <RoundedBox args={[0.34, 0.34, 0.1]} radius={0.04} smoothness={3} position={[length / 2 - 0.45, 0.68, -0.1]} rotation={[-0.3, -0.3, -0.1]}>
        <meshStandardMaterial color="#d8d4cb" roughness={0.9} />
      </RoundedBox>
    </group>
  );
}

function CoffeeTable({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.55, 0.55, 0.035, 32]} />
        <meshStandardMaterial color="#e8e4dc" roughness={0.2} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 0.38, 12]} />
        <meshStandardMaterial color={BRASS} metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.3, 0.32, 0.03, 24]} />
        <meshStandardMaterial color={BRASS} metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0.15, 0.435, 0.05]} rotation={[0, 0.4, 0]}>
        <boxGeometry args={[0.24, 0.04, 0.17]} />
        <meshStandardMaterial color="#2b3a55" roughness={0.7} />
      </mesh>
      <mesh position={[-0.18, 0.44, -0.12]}>
        <cylinderGeometry args={[0.04, 0.034, 0.05, 14]} />
        <meshStandardMaterial color="#f4f0e8" roughness={0.4} />
      </mesh>
    </group>
  );
}

function FloorLamp({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.16, 0.18, 0.04, 20]} />
        <meshStandardMaterial color="#1b1d22" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 1.7, 8]} />
        <meshStandardMaterial color={BRASS} metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, 1.78, 0]}>
        <cylinderGeometry args={[0.16, 0.22, 0.26, 20, 1, true]} />
        <meshStandardMaterial color="#f4e9d3" emissive="#ffd9a0" emissiveIntensity={1.1} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Decoração de parede
// ---------------------------------------------------------------------------

function useTextTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number) {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    draw(ctx, w, h);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    if (materialRef.current) {
      materialRef.current.map = texture;
      materialRef.current.needsUpdate = true;
    }
    return () => texture.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- desenho estático
  }, []);
  return materialRef;
}

function NeonSign({ x, y, z }: { x: number; y: number; z: number }) {
  const material = useTextTexture((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = PALETTE.brand;
    ctx.shadowBlur = 28;
    ctx.fillStyle = "#ffd6dc";
    ctx.font = "800 150px ui-sans-serif, system-ui";
    ctx.fillText("ID LOUNGE", w / 2, h / 2 - 6);
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.brand;
    ctx.fillRect(w / 2 - 170, h - 34, 340, 8);
  }, 1024, 256);
  return (
    <mesh position={[x, y, z]}>
      <planeGeometry args={[2.6, 0.65]} />
      <meshBasicMaterial ref={material} transparent toneMapped={false} />
    </mesh>
  );
}

function WallArt({ x, y, z, w, h, hue }: { x: number; y: number; z: number; w: number; h: number; hue: number }) {
  const material = useTextTexture((ctx, cw, ch) => {
    ctx.fillStyle = "#f1ede4";
    ctx.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 5; i += 1) {
      ctx.fillStyle = `hsl(${(hue + i * 38) % 360} 55% ${38 + i * 6}%)`;
      ctx.beginPath();
      ctx.arc(cw * (0.2 + i * 0.15), ch * (0.35 + ((i * 37) % 30) / 100), ch * (0.12 + i * 0.03), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#1b1d22";
    ctx.fillRect(cw * 0.1, ch * 0.78, cw * 0.8, 6);
  }, 256, 160);
  return (
    <group position={[x, y, z]}>
      <mesh>
        <boxGeometry args={[w + 0.08, h + 0.08, 0.04]} />
        <meshStandardMaterial color="#14161b" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.022]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial ref={material} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Sala completa
// ---------------------------------------------------------------------------

export function LoungeRoom({ layout, life }: { layout: LoungeLayout; life?: LifeSim }) {
  const quality = useUiStore((st) => st.quality);
  const f = layout.furniture;
  const backZ = layout.minZ;
  const centerX = layout.x0 + layout.width / 2;
  const wallSlats = useMemo(
    () => Array.from({ length: Math.round((layout.width - 0.6) / 0.14) }).map((_, i) => ({ p: [layout.x0 + 0.3 + 0.07 + i * 0.14, 1.7, backZ + 0.16] as [number, number, number], c: i % 5 === 2 ? "#6d4c34" : "#7a5639" })),
    [layout.x0, layout.width, backZ],
  );
  return (
    <group>
      {/* painel de ripas de madeira + LED na parede de fundo */}
      <mesh position={[centerX, 1.7, backZ + 0.13]} receiveShadow>
        <boxGeometry args={[layout.width - 0.6, 2.9, 0.04]} />
        <meshStandardMaterial color="#33261d" roughness={0.85} />
      </mesh>
      <InstancedBoxes size={[0.07, 2.9, 0.03]} items={wallSlats} />
      <mesh position={[centerX, 0.12, backZ + 0.2]}>
        <boxGeometry args={[layout.width - 0.6, 0.03, 0.03]} />
        <meshStandardMaterial color="#ffb877" emissive="#ff9a4d" emissiveIntensity={1.4} />
      </mesh>
      <NeonSign x={layout.x0 + 4.4} y={3.05} z={backZ + 0.19} />
      {f.art.map((a, i) => (
        <WallArt key={i} x={a.x + 4.2} y={a.y - 0.25} z={backZ + 0.2} w={a.w * 0.8} h={a.h * 0.8} hue={i * 70 + 10} />
      ))}

      {/* tapete e sofás */}
      <RoundedBox args={[f.rug.w, 0.014, f.rug.d]} radius={0.03} smoothness={2} position={[f.rug.x, 0.008, f.rug.z]} receiveShadow>
        <meshStandardMaterial color="#2c3446" roughness={1} />
      </RoundedBox>
      <mesh position={[f.rug.x, 0.016, f.rug.z]}>
        <boxGeometry args={[f.rug.w - 0.4, 0.004, f.rug.d - 0.4]} />
        <meshStandardMaterial color="#3a4660" roughness={1} />
      </mesh>
      {f.sofas.map((sf, i) => (
        <Sofa key={i} x={sf.x} z={sf.z} yaw={sf.yaw} length={sf.length} color={i % 2 ? "#3f4a63" : "#35445f"} />
      ))}
      {f.armchairs.map((a, i) => (
        <Sofa key={i} x={a.x} z={a.z} yaw={a.yaw} length={1.0} color="#5a3e33" />
      ))}
      {f.coffeeTables.map((t, i) => (
        <CoffeeTable key={i} x={t.x} z={t.z} />
      ))}
      {f.floorLamps.map((l, i) => (
        <FloorLamp key={i} x={l.x} z={l.z} />
      ))}

      <PoolTable x={f.pool.x} z={f.pool.z} life={life} />
      <Bar layout={layout} life={life} />

      {f.plants.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <TallPlant scale={0.9 + (i % 2) * 0.12} />
        </group>
      ))}

      {/* iluminação: poucas luzes, bem posicionadas */}
      {quality === "high" && <pointLight position={[f.sofas[0].x, 2.7, f.rug.z - 0.5]} intensity={1.5} color="#ffd9a8" distance={7.5} decay={1.6} />}
      {quality === "high" && <pointLight position={[f.sofas[f.sofas.length - 1].x, 2.7, f.rug.z - 0.5]} intensity={1.5} color="#ffd9a8" distance={7.5} decay={1.6} />}
      {quality !== "low" && <pointLight position={[f.bar.x - 0.8, 2.8, f.bar.z]} intensity={1.6} color="#ffc98a" distance={7.5} decay={1.6} />}
      {quality !== "low" && <pointLight position={[f.pool.x, 2.6, f.pool.z]} intensity={2.4} color="#fff0d6" distance={5.5} decay={1.5} />}
    </group>
  );
}

