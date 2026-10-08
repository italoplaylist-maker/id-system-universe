import { prisma } from "@/server/db/client";
import { getProjectScope } from "@/server/auth/project-access";
import type { SessionUser } from "@/server/auth/session";
import { chargeWhere } from "@/server/billing/billing-access";

export interface WhatsAppMessageItem {
  id: string;
  clientName: string | null;
  chargeId: string | null;
  chargeDescription: string | null;
  kind: string;
  status: string;
  toPhone: string;
  body: string;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

/** Histórico geral de mensagens enviadas pelo canal WhatsApp (respeitando Project Access). */
export async function listWhatsAppMessages(user: SessionUser, options: { limit?: number; status?: string } = {}): Promise<WhatsAppMessageItem[]> {
  const scope = await getProjectScope(user);
  const rows = await prisma.whatsAppMessage.findMany({
    where: {
      ...(scope.all ? {} : { charge: chargeWhere(scope) }),
      ...(options.status && ["PENDING", "PROCESSING", "SENT", "FAILED"].includes(options.status) ? { status: options.status as "SENT" } : {}),
    },
    include: { client: { select: { name: true, tradeName: true } }, charge: { select: { description: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(options.limit ?? 100, 300),
  });
  return rows.map((m) => ({
    id: m.id,
    clientName: m.client ? (m.client.tradeName ?? m.client.name) : null,
    chargeId: m.chargeId,
    chargeDescription: m.charge?.description ?? null,
    kind: m.kind,
    status: m.status,
    toPhone: m.toPhone,
    body: m.body,
    error: m.error,
    createdAt: m.createdAt.toISOString(),
    sentAt: m.sentAt?.toISOString() ?? null,
  }));
}
