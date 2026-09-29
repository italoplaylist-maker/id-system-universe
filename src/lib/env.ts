import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .min(1, "CREDENTIAL_ENCRYPTION_KEY is required")
    .refine((value) => {
      try {
        return Buffer.from(value, "base64").length === 32;
      } catch {
        return false;
      }
    }, "CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validates process.env once, on first server-side access, instead of at
 * import time — so client bundles that accidentally import this module fail
 * loudly instead of leaking a parsed server env object.
 */
export function getEnv(): Env {
  if (cached) return cached;
  if (typeof window !== "undefined") {
    throw new Error("getEnv() must only be called on the server");
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
