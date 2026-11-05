import type { RecordUniverseEventInput, UniverseEventType } from "@/server/events/universe-events";
import type { NotificationInput } from "./types";

type Mapped = Pick<NotificationInput, "kind" | "level"> & { title: (e: RecordUniverseEventInput) => string };

/** Só o que vale um aviso: terminou/falhou/caiu/voltou. Sincronizações, atribuições e pedidos recebidos ficam de fora (ruído). */
const MAP: Partial<Record<UniverseEventType, Mapped>> = {
  DEPLOYMENT_COMPLETED: { kind: "deploy", level: "success", title: (e) => `Deploy concluído${e.applicationName ? ` · ${e.applicationName}` : ""}` },
  DEPLOYMENT_FAILED: { kind: "deploy", level: "error", title: (e) => `Deploy falhou${e.applicationName ? ` · ${e.applicationName}` : ""}` },
  APPLICATION_ERROR: { kind: "deploy", level: "error", title: (e) => `Erro no app${e.applicationName ? ` · ${e.applicationName}` : ""}` },
  RESTART_COMPLETED: { kind: "deploy", level: "success", title: (e) => `Reinício concluído${e.applicationName ? ` · ${e.applicationName}` : ""}` },
  SERVER_OFFLINE: { kind: "server", level: "error", title: () => "Servidor fora do ar" },
  SERVER_RECOVERED: { kind: "server", level: "success", title: () => "Servidor voltou" },
  SERVER_CPU_HIGH: { kind: "server", level: "warning", title: () => "CPU alta no servidor" },
  SERVER_MEM_HIGH: { kind: "server", level: "warning", title: () => "Memória alta no servidor" },
  SERVER_DISK_HIGH: { kind: "server", level: "warning", title: () => "Disco quase cheio" },
  PROVIDER_CONNECTION_FAILED: { kind: "server", level: "error", title: () => "Conexão com o Coolify falhou" },
  PROVIDER_CONNECTION_RESTORED: { kind: "server", level: "success", title: () => "Conexão com o Coolify restabelecida" },
  BILLING_OVERDUE: { kind: "billing", level: "warning", title: () => "Cobrança em atraso" },
  BILLING_DUE_TODAY: { kind: "billing", level: "info", title: () => "Cobrança vence hoje" },
};

export function universeEventToNotification(e: RecordUniverseEventInput): NotificationInput | null {
  const m = MAP[e.type];
  if (!m) return null;
  const isServer = m.kind === "server";
  return {
    kind: m.kind,
    level: m.level,
    title: m.title(e),
    body: e.message,
    url: m.kind === "billing" ? "/billing" : m.kind === "server" ? "/servers" : "/",
    tag: `${e.type}:${e.applicationId ?? e.providerId ?? e.projectId ?? "x"}`,
    audience: {
      projectId: e.projectId ?? null,
      permission: e.permission ?? (m.kind === "billing" ? "billing:view" : undefined),
      requireGlobal: isServer ? true : undefined,
    },
  };
}
