import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { setConfig } from "@/server/integrations/config";
import { validateProviderBaseUrl } from "@/server/security/ssrf";
import { getWhatsAppConfigSummary, getWhatsAppProvider, type WhatsAppConfigSummary, type WhatsAppStatus } from "@/server/whatsapp/whatsapp-provider";
import { parseHHmm } from "@/lib/civil-date";
import { getBillingSettings } from "@/server/billing/settings";

const schema = z.object({
  provider: z.enum(["EVOLUTION"]).optional(),
  baseUrl: z.string().trim().min(1).optional(),
  instance: z.string().trim().regex(/^[\w.-]{1,100}$/, "Nome de instância inválido.").optional(),
  // Ausente = manter; string vazia = remover.
  apiKey: z.string().optional(),
  timezone: z.string().trim().min(1).optional(),
  windowStart: z.string().optional(),
  windowEnd: z.string().optional(),
});

export interface WhatsAppSettingsView extends WhatsAppConfigSummary {
  timezone: string;
  windowStart: string;
  windowEnd: string;
}

export async function getWhatsAppSettingsView(): Promise<WhatsAppSettingsView> {
  const [summary, billing] = await Promise.all([getWhatsAppConfigSummary(), getBillingSettings()]);
  return { ...summary, timezone: billing.timezone, windowStart: billing.windowStart, windowEnd: billing.windowEnd };
}

export async function updateWhatsAppSettings(input: unknown, actor: { userId: string; ip?: string; userAgent?: string }): Promise<WhatsAppSettingsView> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  if (data.baseUrl !== undefined) {
    const { normalizedBaseUrl } = await validateProviderBaseUrl(data.baseUrl);
    await setConfig("whatsapp.baseUrl", normalizedBaseUrl);
  }
  if (data.provider !== undefined) await setConfig("whatsapp.provider", data.provider);
  if (data.instance !== undefined) await setConfig("whatsapp.instance", data.instance);
  if (data.apiKey !== undefined) await setConfig("whatsapp.apiKey", data.apiKey);
  if (data.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: data.timezone });
    } catch {
      throw new ValidationError("Fuso horário inválido.");
    }
    await setConfig("billing.timezone", data.timezone);
  }
  if (data.windowStart !== undefined || data.windowEnd !== undefined) {
    const current = await getBillingSettings();
    const start = data.windowStart ?? current.windowStart;
    const end = data.windowEnd ?? current.windowEnd;
    const startMin = parseHHmm(start);
    const endMin = parseHHmm(end);
    if (startMin === null || endMin === null || startMin >= endMin) throw new ValidationError("Janela de envio inválida (use HH:mm e início antes do fim).");
    await setConfig("billing.windowStart", start);
    await setConfig("billing.windowEnd", end);
  }

  await recordAuditEvent({
    userId: actor.userId,
    action: "WHATSAPP_CONFIG_UPDATED",
    status: "SUCCESS",
    entityType: "WhatsApp",
    metadata: { changed: Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined) },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
  return getWhatsAppSettingsView();
}

export async function checkWhatsAppConnection(): Promise<WhatsAppStatus> {
  try {
    return await (await getWhatsAppProvider()).getStatus();
  } catch {
    return { connected: false, detail: "Não configurado" };
  }
}
