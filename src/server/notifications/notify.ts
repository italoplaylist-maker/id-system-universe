import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { getProjectScope } from "@/server/auth/project-access";
import { notificationBus } from "./bus";
import { audienceAllows, DEFAULT_PREFS, type Recipient } from "./audience";
import { deliverPush } from "./push";
import { sendWhatsAppNotification } from "./whatsapp-channel";
import type { NotificationInput, NotificationPayload, PrefKind } from "./types";

const KIND_FIELD: Record<PrefKind, "deploys" | "agents" | "approvals" | "servers" | "billing"> = {
  deploy: "deploys",
  agent: "agents",
  approval: "approvals",
  server: "servers",
  billing: "billing",
};

export function prefsToEnabled(p: { deploys: boolean; agents: boolean; approvals: boolean; servers: boolean; billing: boolean } | null): Recipient["enabled"] {
  if (!p) return { ...DEFAULT_PREFS };
  return { deploy: p.deploys, agent: p.agents, approval: p.approvals, server: p.servers, billing: p.billing };
}
export { KIND_FIELD };

/**
 * Avisa quem deve saber: pop-up nas abas abertas (via SSE, no barramento) e push no celular/computador de
 * quem ativou. Nunca lança erro: uma falha de notificação não pode derrubar o deploy, a tarefa ou o monitoramento.
 */
export async function notify(input: NotificationInput): Promise<void> {
  try {
    const payload: NotificationPayload = {
      id: randomUUID(),
      kind: input.kind,
      level: input.level,
      title: input.title.slice(0, 120),
      body: input.body.slice(0, 300),
      url: input.url ?? "/",
      tag: input.tag ?? `${input.kind}:${randomUUID()}`,
      ts: new Date().toISOString(),
    };
    notificationBus.emit({ payload, audience: input.audience, kind: input.kind });

    const users = await prisma.user.findMany({
      where: { active: true, OR: [{ pushSubscriptions: { some: {} } }, { notificationPreference: { is: { whatsappEnabled: true, whatsappNumber: { not: null } } } }] },
      include: { pushSubscriptions: true, notificationPreference: true },
    });
    await Promise.all(
      users.map(async (u) => {
        const scope = await getProjectScope(u);
        const recipient: Recipient = { user: u, scope, enabled: prefsToEnabled(u.notificationPreference) };
        if (!audienceAllows(recipient, input.kind, input.audience)) return;
        await Promise.all([
          ...u.pushSubscriptions.map((s) => deliverPush({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload)),
          // WhatsApp: chega com o app fechado em qualquer celular, sem instalar nada
          u.notificationPreference?.whatsappEnabled && u.notificationPreference.whatsappNumber ? sendWhatsAppNotification(u.notificationPreference.whatsappNumber, payload) : Promise.resolve(),
        ]);
      }),
    );
  } catch (error) {
    logger.warn("notify_failed", { message: error instanceof Error ? error.message : String(error) });
  }
}

export interface TestResult {
  push: Array<{ device: string; ok: boolean; detail?: string }>;
  whatsapp: { sent: boolean; ok?: boolean; detail?: string };
}

/** Rótulo curto do aparelho a partir do User-Agent guardado na ativação. */
export function deviceLabel(ua: string | null | undefined): string {
  const u = ua ?? "";
  const os = /iPhone/i.test(u) ? "iPhone" : /iPad/i.test(u) ? "iPad" : /Android/i.test(u) ? "Android" : /Windows/i.test(u) ? "Windows" : /Mac OS X|Macintosh/i.test(u) ? "Mac" : /Linux/i.test(u) ? "Linux" : "Aparelho";
  const br = /Edg\//i.test(u) ? "Edge" : /Firefox|FxiOS/i.test(u) ? "Firefox" : /Chrome|CriOS/i.test(u) ? "Chrome" : /Safari/i.test(u) ? "Safari" : "";
  return br ? `${os} · ${br}` : os;
}

/** Teste de ponta a ponta COM resultado: diz se cada aparelho aceitou a entrega (ou o erro) e se o WhatsApp saiu. */
export async function sendTestNotification(userId: string, channel: "push" | "whatsapp" | "all"): Promise<TestResult> {
  const payload: NotificationPayload = { id: randomUUID(), kind: "test", level: "success", title: "Notificações funcionando", body: "Se você está vendo isto com o app fechado, está tudo certo.", url: "/", tag: "test", ts: new Date().toISOString() };
  const result: TestResult = { push: [], whatsapp: { sent: false } };
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { pushSubscriptions: true, notificationPreference: true } });
  if (!user) return result;
  if (channel === "push" || channel === "all") {
    notificationBus.emit({ payload, audience: { userId }, kind: "test" }); // pop-up nas abas abertas
    for (const s of user.pushSubscriptions) {
      const r = await deliverPush({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload);
      result.push.push({ device: deviceLabel(s.userAgent), ok: r.ok, detail: r.detail });
    }
  }
  if (channel === "whatsapp" || channel === "all") {
    const num = user.notificationPreference?.whatsappNumber;
    if (num) {
      const r = await sendWhatsAppNotification(num, payload);
      result.whatsapp = { sent: true, ok: r.ok, detail: r.detail };
    }
  }
  return result;
}
