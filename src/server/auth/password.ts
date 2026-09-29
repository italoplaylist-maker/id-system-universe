import { hash, verify } from "@node-rs/argon2";
import { MIN_PASSWORD_LENGTH_CLIENT } from "@/lib/constants";

// OWASP-recommended Argon2id parameters for an interactive login (2024/2025
// baseline): 19 MiB memory, 2 iterations, 1 degree of parallelism.
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(hashValue: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(hashValue, plaintext);
  } catch {
    return false;
  }
}

export function isPasswordStrongEnough(plaintext: string): boolean {
  return plaintext.length >= MIN_PASSWORD_LENGTH_CLIENT;
}

export const MIN_PASSWORD_LENGTH = MIN_PASSWORD_LENGTH_CLIENT;
