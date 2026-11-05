export type NotificationKind = "deploy" | "agent" | "approval" | "server" | "billing" | "test";
export type PrefKind = Exclude<NotificationKind, "test">;
export type NotificationLevel = "success" | "error" | "warning" | "info";

/** Quem pode receber: o mesmo critério vale para o pop-up (SSE) e para o push no celular/computador. */
export interface NotificationAudience {
  /** Projeto do evento (null/undefined = sem projeto → só quem tem acesso global). */
  projectId?: string | null;
  /** Permissão exigida (ex.: "billing:view", "provider:read"). */
  permission?: string;
  /** Exige acesso global (agentes e servidores não pertencem a um projeto). */
  requireGlobal?: boolean;
  /** Só este usuário (aviso de teste). */
  userId?: string;
}

export interface NotificationInput {
  kind: NotificationKind;
  level: NotificationLevel;
  title: string;
  body: string;
  /** Para onde o clique leva (caminho relativo). */
  url?: string;
  /** Mesma tag = a notificação nova substitui a anterior (não empilha). */
  tag?: string;
  audience: NotificationAudience;
}

export interface NotificationPayload {
  id: string;
  kind: NotificationKind;
  level: NotificationLevel;
  title: string;
  body: string;
  url: string;
  tag: string;
  ts: string;
}
