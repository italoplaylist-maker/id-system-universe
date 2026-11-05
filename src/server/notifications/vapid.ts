import webpush from "web-push";
import { prisma } from "@/server/db/client";
import { decryptSecret, encryptSecret } from "@/server/crypto/encryption";
import { getAppOrigin } from "@/server/http/public-url";

/**
 * Chaves VAPID (identificam o servidor perante o serviço de push do navegador).
 * Vêm do ambiente (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY) ou, sem configuração, são geradas UMA vez e guardadas
 * no banco (a privada cifrada) — assim funciona sem ninguém mexer em variável de ambiente e sobrevive a redeploys.
 */
const PUB = "vapid.public";
const PRIV = "vapid.private";

let cached: { publicKey: string; privateKey: string } | null = null;

export async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (cached) return cached;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cached = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return cached;
  }
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: [PUB, PRIV] } } });
  const pub = rows.find((r) => r.key === PUB)?.value;
  const priv = rows.find((r) => r.key === PRIV)?.value;
  if (pub && priv) {
    cached = { publicKey: pub, privateKey: decryptSecret(priv) };
    return cached;
  }
  const fresh = webpush.generateVAPIDKeys();
  // create-if-absent: duas instâncias subindo juntas não sobrescrevem as chaves uma da outra
  await prisma.systemSetting.createMany({
    data: [
      { key: PUB, value: fresh.publicKey },
      { key: PRIV, value: encryptSecret(fresh.privateKey) },
    ],
    skipDuplicates: true,
  });
  const again = await prisma.systemSetting.findMany({ where: { key: { in: [PUB, PRIV] } } });
  cached = {
    publicKey: again.find((r) => r.key === PUB)!.value,
    privateKey: decryptSecret(again.find((r) => r.key === PRIV)!.value),
  };
  return cached;
}

export function vapidSubject(): string {
  return process.env.VAPID_SUBJECT || getAppOrigin() || "mailto:notificacoes@id-system.local";
}

export function resetVapidCache() {
  cached = null;
}
