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
  | "user:manage";

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set([
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
  ]),
  OPERATOR: new Set([
    "provider:read",
    "application:read",
    "application:logs",
    "application:start",
    "application:stop",
    "application:restart",
    "application:redeploy",
    "activity:read",
  ]),
  VIEWER: new Set(["provider:read", "application:read", "application:logs", "activity:read"]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
