/** Barramento em processo: o worker avisa, o SSE repassa. Sobrevive ao hot-reload (globalThis). */
export interface OrchestratorEvent {
  type: "agent" | "task" | "event" | "approval" | "settings";
  agentId?: string;
  taskId?: string;
}

type Listener = (event: OrchestratorEvent) => void;

const g = globalThis as unknown as { __isuOrchestratorBus?: Set<Listener> };
const listeners = (g.__isuOrchestratorBus ??= new Set<Listener>());

export const orchestratorBus = {
  emit(event: OrchestratorEvent) {
    for (const l of listeners) {
      try {
        l(event);
      } catch {
        // um ouvinte quebrado não pode derrubar o worker
      }
    }
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
