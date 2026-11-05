import { create } from "zustand";
import type { GraphicsQuality } from "@/components/universe/hq/render/quality";
import { readStoredQuality, writeStoredQuality } from "@/components/universe/hq/render/quality";

export type ViewMode = "UNIVERSE" | "LIST";
export type PanelTab = "overview" | "logs" | "deployments" | "github";

let requestedTabTokenCounter = 0;

interface UiState {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  selectedApplicationId: string | null;
  selectApplication: (id: string | null) => void;

  /** A token-stamped request so the panel can react even if the same tab is requested twice in a row. */
  requestedTab: { tab: PanelTab; token: number } | null;
  requestTab: (tab: PanelTab) => void;
  clearRequestedTab: () => void;

  /** Diálogo de notificações (aberto pelo sino ou pelo aviso "ative as notificações"). */
  notificationsOpen: boolean;
  setNotificationsOpen: (open: boolean) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  /** Nível de qualidade gráfica da sede 3D. `reducedGraphics` continua existindo (= nível "low") para quem já o usa. */
  quality: GraphicsQuality;
  setQuality: (value: GraphicsQuality) => void;
  /** Lê a preferência deste dispositivo (só no cliente, depois da hidratação, para não divergir do HTML do servidor). */
  hydrateQuality: () => void;
  reducedGraphics: boolean;
  setReducedGraphics: (value: boolean) => void;

  demoMode: boolean;
  setDemoMode: (value: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  viewMode: "UNIVERSE",
  setViewMode: (viewMode) => set({ viewMode }),

  selectedApplicationId: null,
  selectApplication: (id) => set({ selectedApplicationId: id }),

  requestedTab: null,
  requestTab: (tab) => set({ requestedTab: { tab, token: ++requestedTabTokenCounter } }),
  clearRequestedTab: () => set({ requestedTab: null }),

  notificationsOpen: false,
  setNotificationsOpen: (notificationsOpen) => set({ notificationsOpen }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

  quality: "high",
  hydrateQuality: () => {
    const quality = readStoredQuality();
    set({ quality, reducedGraphics: quality === "low" });
  },
  setQuality: (quality) => {
    writeStoredQuality(quality);
    set({ quality, reducedGraphics: quality === "low" });
  },
  reducedGraphics: false,
  setReducedGraphics: (reducedGraphics) => {
    const quality: GraphicsQuality = reducedGraphics ? "low" : "high";
    writeStoredQuality(quality);
    set({ reducedGraphics, quality });
  },

  demoMode: false,
  setDemoMode: (demoMode) => set({ demoMode }),
}));
