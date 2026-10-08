import { prisma } from "@/server/db/client";
import { decryptSecret, encryptSecret } from "@/server/crypto/encryption";

/**
 * Configuração de integrações (GitHub App, WhatsApp). Valores secretos são
 * criptografados em repouso e NUNCA devolvidos ao navegador — a UI só recebe
 * "está configurado?". O ambiente (.env) serve de fallback para deploys que
 * preferem não guardar segredos no banco.
 */
export type ConfigKey =
  | "github.appId"
  | "github.appSlug"
  | "github.privateKey"
  | "github.webhookSecret"
  | "whatsapp.provider"
  | "whatsapp.baseUrl"
  | "whatsapp.apiKey"
  | "whatsapp.instance"
  | "billing.timezone"
  | "billing.windowStart"
  | "billing.windowEnd";

const SECRET_KEYS: ReadonlySet<ConfigKey> = new Set(["github.privateKey", "github.webhookSecret", "whatsapp.apiKey"]);

const ENV_FALLBACK: Partial<Record<ConfigKey, string>> = {
  "github.appId": "GITHUB_APP_ID",
  "github.appSlug": "GITHUB_APP_SLUG",
  "github.privateKey": "GITHUB_APP_PRIVATE_KEY",
  "github.webhookSecret": "GITHUB_APP_WEBHOOK_SECRET",
  "whatsapp.baseUrl": "WHATSAPP_API_URL",
  "whatsapp.apiKey": "WHATSAPP_API_KEY",
  "whatsapp.instance": "WHATSAPP_INSTANCE",
};

export function isSecretKey(key: ConfigKey): boolean {
  return SECRET_KEYS.has(key);
}

export async function getConfig(key: ConfigKey): Promise<string | undefined> {
  const row = await prisma.integrationConfig.findUnique({ where: { key } });
  if (row) return row.secret ? decryptSecret(row.value) : row.value;
  const envName = ENV_FALLBACK[key];
  const fromEnv = envName ? process.env[envName] : undefined;
  if (!fromEnv) return undefined;
  // Chaves PEM em variável de ambiente costumam vir com "\n" literais.
  return key === "github.privateKey" ? fromEnv.replace(/\\n/g, "\n") : fromEnv;
}

export async function getConfigs(keys: ConfigKey[]): Promise<Partial<Record<ConfigKey, string>>> {
  const entries = await Promise.all(keys.map(async (key) => [key, await getConfig(key)] as const));
  return Object.fromEntries(entries.filter((entry): entry is readonly [ConfigKey, string] => entry[1] !== undefined));
}

export async function setConfig(key: ConfigKey, value: string | null): Promise<void> {
  if (value === null || value === "") {
    await prisma.integrationConfig.deleteMany({ where: { key } });
    return;
  }
  const secret = isSecretKey(key);
  const stored = secret ? encryptSecret(value) : value;
  await prisma.integrationConfig.upsert({ where: { key }, create: { key, value: stored, secret }, update: { value: stored, secret } });
}

export async function isConfigured(key: ConfigKey): Promise<boolean> {
  return (await getConfig(key)) !== undefined;
}
