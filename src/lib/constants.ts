/**
 * Constants shared between client and server code. Anything server-only
 * (argon2, prisma) must never be imported from a client component, so the
 * single number both sides need lives here instead of in server/auth/password.ts.
 */
export const MIN_PASSWORD_LENGTH_CLIENT = 12;
