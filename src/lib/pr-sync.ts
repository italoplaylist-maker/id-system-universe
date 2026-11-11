/** Sincronia dos PRs dos agentes com o GitHub — lógica PURA: o que fazer com um PR que o Universe ainda tem como aberto. */

export interface GithubPullState {
  /** "open" | "closed" */
  state: string;
  merged: boolean;
}

export type PrAction =
  | { kind: "keep" }
  | { kind: "mark"; status: "MERGED" | "CLOSED"; reason: string }
  | { kind: "close"; reason: string };

/**
 * `pull` = null quando o GitHub devolveu 404 (PR apagado).
 * `newerSameBranch` = existe PR MAIS NOVO do mesmo agente, no mesmo repositório e na mesma branch (o antigo foi ultrapassado).
 * `compareStatus` = situação da branch do PR frente à principal no GitHub ("identical"/"behind" = nada a mergear).
 */
export function decidePrAction(i: { pull: GithubPullState | null; newerSameBranch: boolean; compareStatus: string | null }): PrAction {
  if (!i.pull) return { kind: "mark", status: "CLOSED", reason: "O PR não existe mais no GitHub." };
  if (i.pull.merged) return { kind: "mark", status: "MERGED", reason: "Já foi mergeado no GitHub." };
  if (i.pull.state !== "open") return { kind: "mark", status: "CLOSED", reason: "Foi fechado no GitHub." };
  if (i.newerSameBranch) return { kind: "close", reason: "Ultrapassado: há um PR mais novo do mesmo agente nesta branch." };
  if (i.compareStatus === "identical" || i.compareStatus === "behind") return { kind: "close", reason: "Ultrapassado: tudo que esta branch tinha já está na branch principal." };
  return { kind: "keep" };
}

/** Evento `pull_request` do webhook → status no Universe (null = não muda nada). */
export function statusFromWebhook(action: string | undefined, merged: boolean | undefined): "OPEN" | "MERGED" | "CLOSED" | null {
  if (action === "closed") return merged ? "MERGED" : "CLOSED";
  if (action === "reopened") return "OPEN";
  return null;
}
