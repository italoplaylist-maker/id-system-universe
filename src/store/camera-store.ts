import { create } from "zustand";

/**
 * Semantic camera state, decoupled from the actual position/target numbers
 * (those live as refs inside UniverseCameraController — see its file header
 * for why). Everything else — the HUD breadcrumb, ESC handling, room
 * highlight, the Project/Resource/Provider "focus" triggers — only ever
 * talks to this store, never to the camera directly ("outros componentes
 * enviam comandos... não manipulam câmera diretamente").
 */
export type CameraMode = "overview" | "free" | "project" | "resource" | "provider";

let nextToken = 1;

export interface CameraCommand {
  token: number;
  kind: "project" | "resource" | "provider" | "point" | "reset";
  /** World point to look at. Ignored for "reset" (the controller uses the HQ's own current overview shot instead). */
  center: [number, number, number];
  /** Room/rack footprint radius — sizes the resulting camera distance. Ignored for "resource" and "point" focus, which use a fixed close distance. */
  radius?: number;
}

interface CameraStoreState {
  mode: CameraMode;
  /** Breadcrumb text ("Italoc", "Fake Coolify", ...), or null in overview/free. */
  focusLabel: string | null;
  /** id of the focused Project/Resource/Provider, so a room/rack/workstation can highlight itself as "this is what the camera is looking at." Null in overview/free. */
  focusId: string | null;
  command: CameraCommand | null;
  focusProject: (id: string, center: [number, number, number], radius: number, label: string) => void;
  focusResource: (id: string, center: [number, number, number], label: string) => void;
  focusProvider: (id: string, center: [number, number, number], radius: number, label: string) => void;
  /** Double-click on empty floor — "look here," without changing zoom level or semantic mode/breadcrumb/focusId. */
  focusPoint: (center: [number, number, number]) => void;
  reset: () => void;
  /** Called by the controller itself the moment the user pans/orbits/zooms/uses WASD — never call this from elsewhere. */
  setFree: () => void;
}

export const useCameraStore = create<CameraStoreState>((set, get) => ({
  mode: "overview",
  focusLabel: null,
  focusId: null,
  command: null,
  focusProject: (id, center, radius, label) => set({ mode: "project", focusLabel: label, focusId: id, command: { token: nextToken++, kind: "project", center, radius } }),
  focusResource: (id, center, label) => set({ mode: "resource", focusLabel: label, focusId: id, command: { token: nextToken++, kind: "resource", center } }),
  focusProvider: (id, center, radius, label) => set({ mode: "provider", focusLabel: label, focusId: id, command: { token: nextToken++, kind: "provider", center, radius } }),
  focusPoint: (center) => set({ command: { token: nextToken++, kind: "point", center } }),
  reset: () => set({ mode: "overview", focusLabel: null, focusId: null, command: { token: nextToken++, kind: "reset", center: [0, 0, 0] } }),
  setFree: () => {
    if (get().mode === "free" && get().focusLabel === null) return;
    set({ mode: "free", focusLabel: null, focusId: null });
  },
}));
