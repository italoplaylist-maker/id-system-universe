/** Client-safe mirror of the Prisma `Role` enum — avoids importing @prisma/client from client components. */
export type Role = "ADMIN" | "OPERATOR" | "VIEWER";

export const ROLES: Role[] = ["ADMIN", "OPERATOR", "VIEWER"];
