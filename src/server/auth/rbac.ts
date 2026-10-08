import type { Role } from "@prisma/client";

/**
 * Central permission table. Nothing in the codebase should branch on
 * `role === "ADMIN"` directly — call `can()` so the policy lives in one
 * place and future roles/permissions only require editing this file.
 */
export type Permission =
  | "provider:read"
  | "provider:write"
  | "provider:test-connection"
  | "application:read"
  | "application:logs"
  | "application:start"
  | "application:stop"
  | "application:restart"
  | "application:redeploy"
  | "application:force-redeploy"
  | "activity:read"
  | "settings:write"
  | "user:manage"
  | "project:read"
  | "project:write"
  | "integration:manage"
  | "billing:view"
  | "billing:manage";

/** Permissões extras que podem ser concedidas a um usuário além do role. */
export const EXTRA_PERMISSIONS = ["BILLING_VIEW", "BILLING_MANAGE"] as const;
export type ExtraPermission = (typeof EXTRA_PERMISSIONS)[number];

const EXTRA_TO_PERMISSIONS: Record<ExtraPermission, readonly Permission[]> = {
  BILLING_VIEW: ["billing:view"],
  // Gerenciar implica poder visualizar.
  BILLING_MANAGE: ["billing:view", "billing:manage"],
};

const ADMIN_PERMISSIONS: readonly Permission[] = [
    "provider:read",
    "provider:write",
    "provider:test-connection",
    "application:read",
    "application:logs",
    "application:start",
    "application:stop",
    "application:restart",
    "application:redeploy",
    "application:force-redeploy",
    "activity:read",
    "settings:write",
    "user:manage",
    "project:read",
    "project:write",
    "integration:manage",
  ];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  // SUPERADMIN: tudo, em todos os projetos (inclui financeiro).
  SUPERADMIN: new Set<Permission>([...ADMIN_PERMISSIONS, "billing:view", "billing:manage"]),
  // ADMIN mantém exatamente o que tinha antes (+ integrações); financeiro só via permissão extra.
  ADMIN: new Set<Permission>(ADMIN_PERMISSIONS),
  OPERATOR: new Set([
    "provider:read",
    "application:read",
    "application:logs",
    "application:start",
    "application:stop",
    "application:restart",
    "application:redeploy",
    "activity:read",
    "project:read",
  ]),
  VIEWER: new Set(["provider:read", "application:read", "application:logs", "activity:read", "project:read"]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export interface PermissionSubject {
  role: Role;
  extraPermissions?: readonly string[];
}

/** Role + permissões extras do usuário. Prefira esta a `can()` sempre que houver um usuário. */
export function canUser(subject: PermissionSubject, permission: Permission): boolean {
  if (can(subject.role, permission)) return true;
  return (subject.extraPermissions ?? []).some((extra) => EXTRA_TO_PERMISSIONS[extra as ExtraPermission]?.includes(permission));
}

/**
 * Acesso GLOBAL a todos os Projects (e a recursos sem Project). Os demais
 * roles só enxergam os Projects listados em ProjectAccess.
 */
export function hasGlobalProjectScope(role: Role): boolean {
  return role === "SUPERADMIN" || role === "ADMIN";
}
