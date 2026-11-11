import type { Obstacle } from "../life/geometry";

/**
 * Sala AGENTES CLT (coordenadas LOCAIS da ala: x largura, z profundidade, frente em +z; a porta fica no meio da
 * parede leste). Dado puro — o desenho 3D e a malha de navegação leem exatamente estes números.
 *
 * Disposição em "ferradura" (nada de fila reta): as estações formam arcos voltados para a mesa de supervisão no
 * centro. O ID Manager ocupa o meio do arco interno e os especialistas se abrem para os lados. No canto leste do
 * fundo fica a sala de reunião (vidro); no canto leste da frente, o espaço de descanso. O corredor da porta fica livre.
 */
/**
 * A sala tem DUAS ilhas circulares. A ala cresce para o lado de fora (oeste local): a ilha AGENTES CLT continua exatamente onde estava em relação
 * à porta (todas as suas coordenadas ganham +CLT_DX) e a ilha COMERCIAL & MARKETING ocupa a metade nova, a oeste.
 */
export const CLT_ISLAND_WIDTH = 18;
export const CLT_ROOM = { width: 36, depth: 15 } as const;
export const CLT_DX = (CLT_ROOM.width - CLT_ISLAND_WIDTH) / 2;

/** Centro da mesa de supervisão (holograma) — as estações olham para ele. */
export const CLT_TABLE = { x: -1.2 + CLT_DX, z: 0.8, r: 1.25 } as const;

const MEETING = { x: 6.3 + CLT_DX, z: -4.9, w: 4.6, d: 3.6 } as const;
const REST = { x: 6.3 + CLT_DX, z: 4.9, w: 4.6, d: 3.4 } as const;

/** Ilha COMERCIAL & MARKETING: núcleo circular com os indicadores e até 6 estações em anel (aberto para o lado da CLT, para circular). */
export const COMMERCIAL_ISLAND = { x: -CLT_ISLAND_WIDTH / 2 - 0.2, z: 0.8, coreR: 1.45, ringR: 3.6 } as const;
export const COMMERCIAL_MAX_STATIONS = 6;

export interface CltStation {
  /** 0 = ID Manager (meio do arco interno); depois alternando para os lados. */
  index: number;
  /** Assento (quadril), em coordenadas locais da ala. */
  x: number;
  z: number;
  /** Giro da mesa em torno do assento (a mesa fica à frente do assento, voltada para a mesa de supervisão). */
  yaw: number;
}

export interface CltLayout {
  width: number;
  depth: number;
  /** z local da porta (parede leste). */
  doorZ: number;
  table: { x: number; z: number; r: number };
  stations: CltStation[];
  meeting: { x: number; z: number; w: number; d: number };
  rest: { x: number; z: number; w: number; d: number };
  plants: Array<{ x: number; z: number }>;
  /** Ilha COMERCIAL & MARKETING (mesma sala): núcleo + estações em anel. */
  commercial: { core: { x: number; z: number; r: number }; stations: CltStation[]; plants: Array<{ x: number; z: number }> };
  /** Móveis fixos que bloqueiam o caminho (locais). As mesas entram à parte, pelas estações. */
  obstacles: Obstacle[];
}

/** Dois anéis de estações: 7 no interno, 7 no externo. */
export const CLT_MAX_STATIONS = 14;

const RINGS = [
  { radius: 3.6, step: 32 },
  { radius: 6.5, step: 24 },
] as const;
/** Direção (graus, a partir de +x rumo a +z) do meio de cada arco: abre para o oeste/fundo, longe da porta. */
const ARC_CENTER_DEG = 200;
/** Ordem dentro de um anel: meio, depois alternando para os dois lados. */
const OFFSETS = [0, 1, -1, 2, -2, 3, -3];

const rad = (d: number) => (d * Math.PI) / 180;

export function computeCltLayout(count: number, commercialCount = 0): CltLayout {
  const n = Math.max(0, Math.min(CLT_MAX_STATIONS, Math.floor(count)));
  const stations: CltStation[] = [];
  for (let i = 0; i < n; i += 1) {
    const ring = RINGS[Math.floor(i / OFFSETS.length)];
    const phi = rad(ARC_CENTER_DEG + OFFSETS[i % OFFSETS.length] * ring.step);
    const x = CLT_TABLE.x + Math.cos(phi) * ring.radius;
    const z = CLT_TABLE.z + Math.sin(phi) * ring.radius;
    // direção do assento para a mesa de supervisão; a mesa de trabalho fica à frente (forward = (−sin ψ, −cos ψ))
    const fx = (CLT_TABLE.x - x) / ring.radius;
    const fz = (CLT_TABLE.z - z) / ring.radius;
    stations.push({ index: i, x, z, yaw: Math.atan2(-fx, -fz) });
  }

  const plants = [
    { x: -8.1 + CLT_DX, z: -6.6 },
    { x: -8.1 + CLT_DX, z: 6.6 },
    { x: 8.1 + CLT_DX, z: -6.6 },
    { x: 8.1 + CLT_DX, z: 6.6 },
  ];

  // Ilha comercial: anel centrado no oeste (abertura para leste, rumo à ilha CLT e à porta).
  const cn = Math.max(0, Math.min(COMMERCIAL_MAX_STATIONS, Math.floor(commercialCount)));
  const cStep = cn <= 1 ? 0 : Math.min(62, 300 / Math.max(1, cn - 1));
  const cStations: CltStation[] = [];
  for (let i = 0; i < cn; i += 1) {
    const phi = rad(180 + (i - (cn - 1) / 2) * cStep);
    const x = COMMERCIAL_ISLAND.x + Math.cos(phi) * COMMERCIAL_ISLAND.ringR;
    const z = COMMERCIAL_ISLAND.z + Math.sin(phi) * COMMERCIAL_ISLAND.ringR;
    const fx = (COMMERCIAL_ISLAND.x - x) / COMMERCIAL_ISLAND.ringR;
    const fz = (COMMERCIAL_ISLAND.z - z) / COMMERCIAL_ISLAND.ringR;
    cStations.push({ index: i, x, z, yaw: Math.atan2(-fx, -fz) });
  }
  const cPlants = [
    { x: -17.1, z: -6.6 },
    { x: -17.1, z: 6.6 },
  ];
  const obstacles: Obstacle[] = [
    { kind: "circle", cx: CLT_TABLE.x, cz: CLT_TABLE.z, r: CLT_TABLE.r + 0.15, label: "clt-table" },
    { kind: "rect", minX: MEETING.x - MEETING.w / 2, maxX: MEETING.x + MEETING.w / 2, minZ: MEETING.z - MEETING.d / 2, maxZ: MEETING.z + MEETING.d / 2, label: "clt-meeting" },
    { kind: "rect", minX: REST.x - REST.w / 2, maxX: REST.x + REST.w / 2, minZ: REST.z - REST.d / 2, maxZ: REST.z + REST.d / 2, label: "clt-rest" },
    ...plants.map((p): Obstacle => ({ kind: "circle", cx: p.x, cz: p.z, r: 0.38, label: "plant" })),
    { kind: "circle", cx: COMMERCIAL_ISLAND.x, cz: COMMERCIAL_ISLAND.z, r: COMMERCIAL_ISLAND.coreR + 0.2, label: "commercial-core" },
    ...cPlants.map((p): Obstacle => ({ kind: "circle", cx: p.x, cz: p.z, r: 0.38, label: "plant" })),
  ];

  return { width: CLT_ROOM.width, depth: CLT_ROOM.depth, doorZ: 0, table: { ...CLT_TABLE }, stations, commercial: { core: { x: COMMERCIAL_ISLAND.x, z: COMMERCIAL_ISLAND.z, r: COMMERCIAL_ISLAND.coreR }, stations: cStations, plants: cPlants }, meeting: { ...MEETING }, rest: { ...REST }, plants, obstacles };
}
