import { create } from "zustand";

export type ViewMode = "UNIVERSE" | "LIST";
export type PanelTab = "overview" | "logs" | "deployments";

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

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

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

  commandPaletteOpen: false,
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

  reducedGraphics: false,
  setReducedGraphics: (reducedGraphics) => set({ reducedGraphics }),

  demoMode: false,
  setDemoMode: (demoMode) => set({ demoMode }),
}));
