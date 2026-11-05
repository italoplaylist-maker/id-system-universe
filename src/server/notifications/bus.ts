import type { NotificationAudience, NotificationPayload } from "./types";

/** Barramento em processo: o SSE de cada aba aberta escuta aqui e filtra pela audiência do usuário. */
export interface BusMessage {
  payload: NotificationPayload;
  audience: NotificationAudience;
  kind: NotificationPayload["kind"];
}
type Listener = (m: BusMessage) => void;

const g = globalThis as unknown as { __isuNotifyBus?: Set<Listener> };
const listeners = (g.__isuNotifyBus ??= new Set<Listener>());

export const notificationBus = {
  emit(m: BusMessage) {
    for (const l of listeners) {
      try {
        l(m);
      } catch {
        // um ouvinte quebrado não derruba os outros
      }
    }
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
