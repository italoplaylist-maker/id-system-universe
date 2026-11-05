/**
 * Ordem e cor ESTÁVEIS dos agentes na Sala dos Agentes. Cada agente tem a sua mesa e a sua cor para sempre:
 * nada que muda a cada atualização (hora do último evento, nome, quantos agentes existem) pode trocar quem senta onde.
 */
export interface OrderableSession {
  id: string;
  startedAt: string;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Funcionários permanentes na ordem em que vieram (a API já os entrega por posição); depois as sessões observadas, da mais antiga à mais nova. */
export function orderAgentSessions<T extends OrderableSession>(permanent: T[], observed: T[]): T[] {
  const known = new Set(permanent.map((p) => p.id));
  const extra = observed.filter((o) => !known.has(o.id)).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  return [...permanent, ...extra];
}

/** Cor derivada do id (não da posição na lista): não muda quando outro agente entra ou sai. */
export function agentAccent(id: string, palette: readonly string[]): string {
  return palette[hash(id) % palette.length];
}
