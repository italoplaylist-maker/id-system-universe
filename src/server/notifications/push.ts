import webpush from "web-push";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { getVapidKeys, vapidSubject } from "./vapid";
import type { NotificationPayload } from "./types";

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}
export type PushSender = (target: PushTarget, payload: NotificationPayload) => Promise<{ ok: true } | { ok: false; gone: boolean }>;

const defaultSender: PushSender = async (t, payload) => {
  const keys = await getVapidKeys();
  try {
    await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(payload), {
      TTL: 3600,
      urgency: payload.level === "error" || payload.kind === "approval" ? "high" : "normal",
      vapidDetails: { subject: vapidSubject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
    });
    return { ok: true };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    return { ok: false, gone: status === 404 || status === 410 };
  }
};

const holder = globalThis as unknown as { __isuPushSender?: PushSender };
export function setPushSender(s: PushSender | null) {
  holder.__isuPushSender = s ?? undefined;
}

/** Entrega a um aparelho; endpoint morto (usuário revogou) é removido, falhas repetidas também. */
export async function deliverPush(target: PushTarget, payload: NotificationPayload): Promise<boolean> {
  const send = holder.__isuPushSender ?? defaultSender;
  const r = await send(target, payload);
  if (r.ok) {
    await prisma.pushSubscription.update({ where: { id: target.id }, data: { lastSuccessAt: new Date(), failures: 0 } }).catch(() => undefined);
    return true;
  }
  if (r.gone) {
    await prisma.pushSubscription.deleteMany({ where: { id: target.id } });
  } else {
    const row = await prisma.pushSubscription.update({ where: { id: target.id }, data: { failures: { increment: 1 } } }).catch(() => null);
    if (row && row.failures >= 10) await prisma.pushSubscription.deleteMany({ where: { id: target.id } });
    logger.warn("push_delivery_failed", { subscriptionId: target.id });
  }
  return false;
}
