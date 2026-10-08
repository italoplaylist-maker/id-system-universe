import { prisma } from "@/server/db/client";
import { getGitHubConfigStatus } from "@/server/github/github-service";
import { checkWhatsAppConnection } from "@/server/whatsapp/whatsapp-config";
import { getWhatsAppConfigSummary } from "@/server/whatsapp/whatsapp-provider";

export type IntegrationState = "CONNECTED" | "DISCONNECTED" | "PROBLEM";

export interface IntegrationCard {
  key: "github" | "coolify" | "whatsapp" | "servers";
  name: string;
  state: IntegrationState;
  detail: string;
}

export async function getIntegrationsOverview(): Promise<IntegrationCard[]> {
  const [github, installations, providers, whatsappSummary] = await Promise.all([
    getGitHubConfigStatus(),
    prisma.gitHubInstallation.findMany({ select: { status: true, accountLogin: true } }),
    prisma.infrastructureProvider.findMany({ where: { enabled: true }, select: { health: true } }),
    getWhatsAppConfigSummary(),
  ]);

  const active = installations.filter((i) => i.status === "ACTIVE");
  const githubCard: IntegrationCard = !github.configured
    ? { key: "github", name: "GitHub", state: "DISCONNECTED", detail: "GitHub App não configurado." }
    : active.length === 0
      ? { key: "github", name: "GitHub", state: "DISCONNECTED", detail: "App configurado, nenhuma conta conectada." }
      : installations.some((i) => i.status === "SUSPENDED")
        ? { key: "github", name: "GitHub", state: "PROBLEM", detail: "Há instalação suspensa." }
        : { key: "github", name: "GitHub", state: "CONNECTED", detail: active.map((i) => i.accountLogin).join(", ") };

  const online = providers.filter((p) => p.health === "ONLINE").length;
  const coolifyCard: IntegrationCard =
    providers.length === 0
      ? { key: "coolify", name: "Coolify", state: "DISCONNECTED", detail: "Nenhuma instância cadastrada." }
      : online === providers.length
        ? { key: "coolify", name: "Coolify", state: "CONNECTED", detail: `${providers.length} instância(s) online.` }
        : { key: "coolify", name: "Coolify", state: "PROBLEM", detail: `${providers.length - online} de ${providers.length} instância(s) com problema.` };

  let whatsappCard: IntegrationCard;
  if (!whatsappSummary.configured) {
    whatsappCard = { key: "whatsapp", name: "WhatsApp", state: "DISCONNECTED", detail: "Não configurado." };
  } else {
    const status = await checkWhatsAppConnection();
    whatsappCard = status.connected
      ? { key: "whatsapp", name: "WhatsApp", state: "CONNECTED", detail: `Instância ${whatsappSummary.instance}.` }
      : { key: "whatsapp", name: "WhatsApp", state: "PROBLEM", detail: `Instância sem conexão (${status.detail ?? "desconhecido"}).` };
  }

  const serversCard: IntegrationCard = {
    key: "servers",
    name: "Servidores / SSH",
    state: providers.length === 0 ? "DISCONNECTED" : online === providers.length ? "CONNECTED" : "PROBLEM",
    detail: providers.length === 0 ? "Nenhum servidor monitorado." : "Servidores monitorados via Coolify. Acesso SSH direto ainda não configurado.",
  };

  return [githubCard, coolifyCard, whatsappCard, serversCard];
}
