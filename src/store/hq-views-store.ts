import { create } from "zustand";

export interface HqView {
  id: string;
  label: string;
  /** Alvo no mundo (x, y, z) e raio do enquadramento. */
  center: [number, number, number];
  radius: number;
}

interface HqViewsState {
  views: HqView[];
  setViews: (views: HqView[]) => void;
}

/** Posições de câmera úteis da sede (sede inteira, núcleo e cada ala). A cena as publica; o HUD as usa. */
export const useHqViews = create<HqViewsState>((set) => ({
  views: [],
  setViews: (views) => set({ views }),
}));
