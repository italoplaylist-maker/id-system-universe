import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { getProjectScope } from "@/server/auth/project-access";
import { notificationBus } from "./bus";
import { audienceAllows, DEFAULT_PREFS, type Recipient } from "./audience";
import { deliverPush } from "./push";
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

    const subs = await prisma.pushSubscription.findMany({
      where: { user: { active: true } },
      include: { user: { include: { notificationPreference: true } } },
    });
    if (subs.length === 0) return;
    const scopes = new Map<string, Awaited<ReturnType<typeof getProjectScope>>>();
    await Promise.all(
      subs.map(async (s) => {
        let scope = scopes.get(s.userId);
        if (!scope) {
          scope = await getProjectScope(s.user);
          scopes.set(s.userId, scope);
        }
        const recipient: Recipient = { user: s.user, scope, enabled: prefsToEnabled(s.user.notificationPreference) };
        if (!audienceAllows(recipient, input.kind, input.audience)) return;
        await deliverPush({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload);
      }),
    );
  } catch (error) {
    logger.warn("notify_failed", { message: error instanceof Error ? error.message : String(error) });
  }
}
