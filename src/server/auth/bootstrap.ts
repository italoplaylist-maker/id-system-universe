import { prisma } from "@/server/db/client";
import { hashPassword, isPasswordStrongEnough, MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { ConflictError, ValidationError } from "@/lib/errors";
import { z } from "zod";

const bootstrapSchema = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH),
});

export async function isBootstrapAvailable(): Promise<boolean> {
  const userCount = await prisma.user.count();
  return userCount === 0;
}

/**
 * Creates the first administrator. Only callable while the user table is
 * empty — once any user exists this permanently refuses, which is what
 * "disable bootstrap automatically after first run" means in practice.
 */
export async function bootstrapAdmin(input: unknown) {
  const available = await isBootstrapAvailable();
  if (!available) {
    throw new ConflictError("Setup already completed. An administrator account already exists.");
  }

  const parsed = bootstrapSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  if (!isPasswordStrongEnough(parsed.data.password)) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const passwordHash = await hashPassword(parsed.data.password);
  return prisma.user.create({
    data: { email: parsed.data.email.toLowerCase(), passwordHash, role: "ADMIN" },
    select: { id: true, email: true, role: true },
  });
}
