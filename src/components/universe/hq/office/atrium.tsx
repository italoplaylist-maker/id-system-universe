"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { PALETTE } from "../palette";
import { TallPlant } from "./office-props";
import { COMMAND_CANVAS, paintScreen, type CommandCenterStats } from "./command-screen";
import { HQ, type HqPlan, type Ramp as RampData } from "../plan/hq-plan";

import { CORE, PLANTER_ANGLES, PLANTER_RADIUS } from "../plan/atrium-layout";

const GRAPHITE = "#2b3038";
const RED = PALETTE.brand;

function Slab({ plan }: { plan: HqPlan }) {
  const { polygon, level } = plan.atrium;
  const geo = useMemo(() => {
    const shape = new THREE.Shape(polygon.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [polygon]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <group>
      <mesh geometry={geo} position={[0, level - 0.9, 0]} receiveShadow castShadow>
        <meshStandardMaterial color="#7b808a" roughness={0.5} metalness={0.05} envMapIntensity={0.8} />
      </mesh>
      {/* friso de LED vermelho no bordo + guarda-corpo de vidro (exceto nas portas das alas) */}
      {polygon.map((a, i) => {
        const b = polygon[(i + 1) % polygon.length];
        const mx = (a.x + b.x) / 2;
        const mz = (a.z + b.z) / 2;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const ang = Math.atan2(-(b.z - a.z), b.x - a.x);
        const mid = Math.atan2(mz, mx);
        const midDeg = ((mid * 180) / Math.PI + 360) % 360;
        const isDoor = [0, 135, 247.5].some((d) => Math.abs(((midDeg - d + 540) % 360) - 180) < 3);
        return (
          <group key={i} position={[mx, level, mz]} rotation={[0, ang, 0]}>
            <mesh position={[0, 0.02, 0]}>
              <boxGeometry args={[len, 0.04, 0.07]} />
              <meshStandardMaterial color={RED} emissive={RED} emissiveIntensity={0.9} toneMapped={false} />
            </mesh>
            {!isDoor && (
              <>
                <mesh position={[0, 0.55, 0]}>
                  <boxGeometry args={[len - 0.06, 1.0, 0.025]} />
                  <meshPhysicalMaterial color="#cfe3ff" transparent opacity={0.16} roughness={0.04} clearcoat={1} envMapIntensity={1.4} depthWrite={false} />
                </mesh>
                <mesh position={[0, 1.07, 0]}>
                  <boxGeometry args={[len, 0.04, 0.06]} />
                  <meshStandardMaterial color="#8d95a3" metalness={0.85} roughness={0.3} />
                </mesh>
              </>
            )}
          </group>
        );
      })}
    </group>
  );
}

function Floor({ level }: { level: number }) {
  const y = level + 0.004;
  return (
    <group>
      {/* anéis de piso: pedra escura no centro, faixa de madeira, filete vermelho */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
        <ringGeometry args={[CORE.radius + 0.1, CORE.radius + 1.9, 64]} />
        <meshStandardMaterial color="#8a6a4a" roughness={0.5} envMapIntensity={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y + 0.002, 0]}>
        <ringGeometry args={[CORE.radius + 1.9, CORE.radius + 1.98, 64]} />
        <meshStandardMaterial color={RED} emissive={RED} emissiveIntensity={0.6} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
        <ringGeometry args={[CORE.radius + 1.98, HQ.ATRIUM_RADIUS * 0.985, 64]} />
        <meshStandardMaterial color="#a9adb6" roughness={0.42} metalness={0.04} envMapIntensity={0.9} />
      </mesh>
    </group>
  );
}

function CommandCore({ level, stats, onOpen, reduced }: { level: number; stats: CommandCenterStats; onOpen?: () => void; reduced: boolean }) {
  const { screenMat, texture } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = COMMAND_CANVAS.width;
    canvas.height = COMMAND_CANVAS.height;
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return { texture: t, screenMat: new THREE.MeshBasicMaterial({ map: t, toneMapped: false }) };
  }, []);
  useEffect(
    () => () => {
      texture.dispose();
      screenMat.dispose();
    },
    [texture, screenMat],
  );
  const ringRef = useRef<THREE.MeshStandardMaterial>(null);
  const signMat = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 170;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, 1024, 170);
    g.fillStyle = "#f4f6fa";
    g.font = "800 112px ui-sans-serif, system-ui";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("ID", 330, 88);
    g.fillStyle = "#e8283f";
    g.fillText("SYSTEM", 640, 88);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthWrite: false });
  }, []);
  useEffect(
    () => () => {
      signMat.map?.dispose();
      signMat.dispose();
    },
    [signMat],
  );

  const key = `${stats.projectCount}|${stats.resourceCount}|${stats.onlineCount}|${stats.deployingCount}|${stats.incidentCount}|${stats.employeeCount}|${stats.billing ? `${stats.billing.pending},${stats.billing.overdue},${stats.billing.dueToday}` : "-"}`;
  useEffect(() => {
    const ctx = (texture.image as HTMLCanvasElement).getContext("2d");
    if (!ctx) return;
    paintScreen(ctx, stats);
    // eslint-disable-next-line react-hooks/immutability -- textura de canvas: reenvio à GPU após repintar
    texture.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repinta só quando os números mudam
  }, [key]);

  // Anel de LED respira bem devagar (desligado em gráficos reduzidos).
  useFrame(({ clock }) => {
    if (reduced || !ringRef.current) return;
    ringRef.current.emissiveIntensity = 1.4 + Math.sin(clock.elapsedTime * 0.9) * 0.25;
  });

  // 4 painéis curvos de ~75° em volta do núcleo; entre eles, pilares de aço que sustentam o anel suspenso.
  const arcs = [0, 1, 2, 3].map((i) => i * (Math.PI / 2) + Math.PI / 4);
  const arcLen = (Math.PI * 75) / 180;
  const h = ((CORE.screenR * arcLen) * COMMAND_CANVAS.height) / COMMAND_CANVAS.width;
  return (
    <group position={[0, level, 0]}>
      {/* plataforma elevada do núcleo, em dois degraus */}
      <mesh position={[0, CORE.platformH / 2 - 0.02, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[CORE.radius, CORE.radius + 0.12, CORE.platformH, 48]} />
        <meshStandardMaterial color="#1c2027" roughness={0.45} metalness={0.4} envMapIntensity={1} />
      </mesh>
      <mesh position={[0, CORE.platformH + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[CORE.radius - 0.05, 48]} />
        <meshStandardMaterial color="#15181e" roughness={0.38} metalness={0.3} envMapIntensity={1.2} />
      </mesh>
      <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[CORE.radius + 0.12, CORE.radius + 0.2, 64]} />
        <meshStandardMaterial color={RED} emissive={RED} emissiveIntensity={1.1} toneMapped={false} />
      </mesh>

      {/* pedestal central: coluna de vidro escuro com base de LED */}
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.55, 0.7, 1.4, 32]} />
        <meshPhysicalMaterial color="#0a0d12" roughness={0.12} metalness={0.5} clearcoat={1} envMapIntensity={1.6} />
      </mesh>
      <mesh position={[0, CORE.platformH + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.72, 0.8, 40]} />
        <meshStandardMaterial color={RED} emissive={RED} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>

      {/* painéis curvos com os indicadores reais; clique abre o log de atividade */}
      {arcs.map((a, i) => (
        <group
          key={i}
          position={[0, CORE.screenY, 0]}
          rotation={[0, a, 0]}
          onClick={
            onOpen
              ? (e) => {
                  e.stopPropagation();
                  onOpen();
                }
              : undefined
          }
          onPointerOver={onOpen ? (e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; } : undefined}
          onPointerOut={onOpen ? () => { document.body.style.cursor = "auto"; } : undefined}
        >
          <mesh>
            <cylinderGeometry args={[CORE.screenR + 0.03, CORE.screenR + 0.03, h + 0.12, 32, 1, true, -arcLen / 2 - 0.02, arcLen + 0.04]} />
            <meshStandardMaterial color="#0b0d12" metalness={0.6} roughness={0.35} side={THREE.DoubleSide} />
          </mesh>
          <mesh material={screenMat}>
            <cylinderGeometry args={[CORE.screenR + 0.045, CORE.screenR + 0.045, h, 32, 1, true, -arcLen / 2, arcLen]} />
          </mesh>
        </group>
      ))}
      {/* pilares de aço escovado e anel de LED suspenso */}
      {arcs.map((a, i) => (
        <mesh key={`p${i}`} position={[Math.sin(a + Math.PI / 4) * (CORE.screenR + 0.2), CORE.ringY / 2 + 0.1, Math.cos(a + Math.PI / 4) * (CORE.screenR + 0.2)]} castShadow>
          <boxGeometry args={[0.1, CORE.ringY, 0.1]} />
          <meshStandardMaterial color="#8d95a3" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, CORE.ringY, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[CORE.screenR + 0.2, 0.05, 12, 64]} />
        <meshStandardMaterial ref={ringRef} color={RED} emissive={RED} emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
      <mesh position={[0, CORE.ringY + 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[CORE.screenR + 0.2, 0.09, 8, 64]} />
        <meshStandardMaterial color={GRAPHITE} metalness={0.85} roughness={0.35} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={`sign${i}`} position={[Math.sin(i * (Math.PI / 2)) * (CORE.screenR + 0.45), CORE.ringY + 0.75, Math.cos(i * (Math.PI / 2)) * (CORE.screenR + 0.45)]} rotation={[0, i * (Math.PI / 2), 0]} material={signMat}>
          <planeGeometry args={[3.0, 0.5]} />
        </mesh>
      ))}
      <pointLight position={[0, CORE.ringY - 0.4, 0]} intensity={3.2} color="#ffd9b0" distance={11} decay={1.8} />
      <pointLight position={[0, 0.5, 0]} intensity={1.2} color={RED} distance={5} decay={2} />
    </group>
  );
}

function Garden({ level }: { level: number }) {
  return (
    <group position={[0, level, 0]}>
      {PLANTER_ANGLES.map((a, i) => (
        <group key={i} position={[Math.cos(a) * PLANTER_RADIUS, 0, Math.sin(a) * PLANTER_RADIUS]}>
          {/* canteiro de madeira escura com cinta de aço */}
          <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.8, 0.86, 0.44, 24]} />
            <meshStandardMaterial color="#4a3526" roughness={0.75} />
          </mesh>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.815, 0.815, 0.04, 24]} />
            <meshStandardMaterial color="#8d95a3" metalness={0.85} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.44, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.76, 24]} />
            <meshStandardMaterial color="#2a1f17" roughness={1} />
          </mesh>
          <group position={[0, 0.4, 0]}>
            <TallPlant scale={1.7 + (i % 2) * 0.25} />
          </group>
        </group>
      ))}
    </group>
  );
}

export function Atrium({ plan, stats, onOpenActivity, reduced }: { plan: HqPlan; stats: CommandCenterStats; onOpenActivity?: () => void; reduced: boolean }) {
  const level = plan.atrium.level;
  return (
    <group>
      <Slab plan={plan} />
      <Floor level={level} />
      <CommandCore level={level} stats={stats} onOpen={onOpenActivity} reduced={reduced} />
      <Garden level={level} />
    </group>
  );
}

/**
 * Rampa de ligação átrio → ala: cunha de madeira com laterais em aço e filete de LED. Desenhada em
 * mundo (não dentro da ala girada) para que a altura bata com o nível do átrio na porta.
 */
export function Ramp({ ramp }: { ramp: RampData }) {
  const width = ramp.rect.hz * 2;
  const geo = useMemo(() => {
    const L = ramp.length;
    const shape = new THREE.Shape();
    shape.moveTo(0, ramp.from);
    shape.lineTo(L, ramp.to);
    shape.lineTo(L, ramp.to - 0.5);
    shape.lineTo(0, ramp.from - 0.5);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    g.translate(0, 0, -width / 2);
    return g;
  }, [ramp, width]);
  useEffect(() => () => geo.dispose(), [geo]);
  const yaw = Math.atan2(-ramp.dir.z, ramp.dir.x);
  const slope = Math.atan2(ramp.to - ramp.from, ramp.length);
  return (
    <group position={[ramp.origin.x, 0, ramp.origin.z]} rotation={[0, yaw, 0]}>
      <mesh geometry={geo} receiveShadow castShadow>
        <meshStandardMaterial color="#8a6a4a" roughness={0.55} envMapIntensity={0.9} />
      </mesh>
      {/* pérgola de madeira sobre a rampa: marca a entrada da ala sem fechar a vista de cima */}
      <group position={[ramp.length / 2, ramp.from + 2.9, 0]}>
        {[-1, 1].map((sd) => (
          <mesh key={`b${sd}`} position={[0, 0, (sd * (width + 0.5)) / 2]} castShadow>
            <boxGeometry args={[ramp.length + 0.6, 0.16, 0.14]} />
            <meshStandardMaterial color={GRAPHITE} metalness={0.85} roughness={0.35} />
          </mesh>
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <mesh key={i} position={[-ramp.length / 2 - 0.2 + (i * (ramp.length + 0.4)) / 7, 0.11, 0]} castShadow>
            <boxGeometry args={[0.07, 0.07, width + 0.5]} />
            <meshStandardMaterial color={i % 3 === 1 ? "#6d4c34" : "#85603f"} roughness={0.72} />
          </mesh>
        ))}
        {[-1, 1].map((sd) => (
          <mesh key={`p${sd}`} position={[ramp.length + 0.2, (ramp.to - ramp.from - 2.9) / 2, (sd * (width + 0.5)) / 2]} castShadow>
            <boxGeometry args={[0.1, ramp.from + 2.9 - ramp.to, 0.1]} />
            <meshStandardMaterial color={GRAPHITE} metalness={0.85} roughness={0.35} />
          </mesh>
        ))}
      </group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[ramp.length / 2, (ramp.from + ramp.to) / 2 + 0.03, (s * width) / 2]} rotation={[0, 0, slope]}>
          <boxGeometry args={[ramp.length, 0.05, 0.05]} />
          <meshStandardMaterial color={RED} emissive={RED} emissiveIntensity={1} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

