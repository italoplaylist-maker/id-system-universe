import { logger } from "@/lib/logger";
import { getAppOrigin } from "@/server/http/public-url";
import { getWhatsAppProvider } from "@/server/whatsapp/whatsapp-provider";
import type { NotificationPayload } from "./types";

export type WhatsAppSender = (phone: string, text: string) => Promise<void>;

const defaultSender: WhatsAppSender = async (phone, text) => {
  const provider = await getWhatsAppProvider();
  await provider.sendText(phone, text);
};

const holder = globalThis as unknown as { __isuNotifyWhatsApp?: WhatsAppSender };
export function setWhatsAppNotifySender(s: WhatsAppSender | null) {
  holder.__isuNotifyWhatsApp = s ?? undefined;
}

const ICON: Record<NotificationPayload["level"], string> = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };

export function whatsappText(p: NotificationPayload): string {
  const origin = getAppOrigin();
  const link = origin && p.url ? (p.url.startsWith("http") ? p.url : `${origin}${p.url}`) : p.url.startsWith("http") ? p.url : "";
  return `${ICON[p.level]} *${p.title}*${p.body ? `\n${p.body}` : ""}${link ? `\n${link}` : ""}`;
}

// O mesmo aviso (mesma tag) para o mesmo número não é repetido em 5 min: um PR/deploy que muda de estado várias vezes não vira spam.
const recent = new Map<string, number>();
const DEDUP_MS = 5 * 60_000;

export async function sendWhatsAppNotification(phone: string, payload: NotificationPayload): Promise<{ ok: boolean; detail?: string }> {
  const key = `${phone}|${payload.tag}`;
  const last = recent.get(key);
  if (last && Date.now() - last < DEDUP_MS && payload.kind !== "test") return { ok: true, detail: "repetido (ignorado)" };
  recent.set(key, Date.now());
  if (recent.size > 500) for (const [k, t] of recent) if (Date.now() - t > DEDUP_MS) recent.delete(k);
  try {
    await (holder.__isuNotifyWhatsApp ?? defaultSender)(phone, whatsappText(payload));
    return { ok: true };
  } catch (error) {
    recent.delete(key);
    logger.warn("notify_whatsapp_failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, detail: error instanceof Error ? error.message.slice(0, 160) : "falha no envio" };
  }
}
