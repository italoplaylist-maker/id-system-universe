/**
 * Níveis de qualidade gráfica da sede 3D. Um único lugar decide o custo de cada recurso,
 * para que "Alto / Médio / Baixo" signifiquem a mesma coisa em toda a cena.
 *
 * "low" é o antigo Reduced Graphics: sem sombras, sem ambiente refletido, sem efeitos.
 */
export type GraphicsQuality = "high" | "medium" | "low";

export interface QualityProfile {
  label: string;
  /** Faixa de devicePixelRatio do canvas. */
  dpr: [number, number];
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Ambiente refletido (iluminação de estúdio procedural) — dá reflexo a vidro, metal e madeira. */
  environment: boolean;
  environmentResolution: number;
  /** Mapas de rugosidade/relevo nos pisos e materiais físicos nos vidros. */
  richMaterials: boolean;
  /** Sombras de contato no chão. */
  contactShadows: boolean;
}

export const QUALITY_PROFILES: Record<GraphicsQuality, QualityProfile> = {
  high: { label: "Alto", dpr: [1, 1.75], antialias: true, shadows: true, shadowMapSize: 2048, environment: true, environmentResolution: 256, richMaterials: true, contactShadows: true },
  medium: { label: "Médio", dpr: [1, 1.25], antialias: true, shadows: true, shadowMapSize: 1024, environment: true, environmentResolution: 128, richMaterials: true, contactShadows: false },
  low: { label: "Baixo", dpr: [1, 1], antialias: false, shadows: false, shadowMapSize: 512, environment: false, environmentResolution: 64, richMaterials: false, contactShadows: false },
};

export const QUALITY_ORDER: GraphicsQuality[] = ["high", "medium", "low"];

const STORAGE_KEY = "isu.graphics-quality";

function isQuality(v: unknown): v is GraphicsQuality {
  return v === "high" || v === "medium" || v === "low";
}

/** Preferência por dispositivo; nunca falha (janela privada, storage bloqueado, SSR). */
export function readStoredQuality(): GraphicsQuality {
  try {
    if (typeof window === "undefined") return "high";
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isQuality(v) ? v : "high";
  } catch {
    return "high";
  }
}

export function writeStoredQuality(q: GraphicsQuality): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, q);
  } catch {
    /* sem persistência: vale só nesta sessão */
  }
}
