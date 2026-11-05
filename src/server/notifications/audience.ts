import { canUser, type PermissionSubject } from "@/server/auth/rbac";
import { scopeAllowsProject, type ProjectScope } from "@/server/auth/project-access";
import type { NotificationAudience, NotificationKind, PrefKind } from "./types";

export interface Recipient {
  user: PermissionSubject & { id?: string };
  scope: ProjectScope;
  /** Tipos ligados nas preferências do usuário. */
  enabled: Record<PrefKind, boolean>;
}

export const DEFAULT_PREFS: Record<PrefKind, boolean> = { deploy: true, agent: true, approval: true, server: true, billing: true };

/** Única regra de "quem vê isto": vale para o pop-up e para o push. Nunca vaza evento fora do escopo do usuário. */
export function audienceAllows(r: Recipient, kind: NotificationKind, a: NotificationAudience): boolean {
  if (a.userId) return r.user.id === a.userId; // aviso de teste: só para quem pediu
  if (kind === "test" || !r.enabled[kind]) return false;
  if (a.permission && !canUser(r.user, a.permission as never)) return false;
  if (a.requireGlobal && !r.scope.all) return false;
  if (a.projectId) return scopeAllowsProject(r.scope, a.projectId);
  // sem projeto: só quem tem acesso global
  return r.scope.all;
}
