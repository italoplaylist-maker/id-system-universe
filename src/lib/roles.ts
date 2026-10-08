/** Client-safe mirror of the Prisma `Role` enum — avoids importing @prisma/client from client components. */
export type Role = "SUPERADMIN" | "ADMIN" | "OPERATOR" | "VIEWER";

export const ROLES: Role[] = ["SUPERADMIN", "ADMIN", "OPERATOR", "VIEWER"];

export const ROLE_LABEL: Record<Role, string> = {
  SUPERADMIN: "Superadmin",
  ADMIN: "Administrador",
  OPERATOR: "Operador",
  VIEWER: "Visualizador",
};
