"use client";

import { useSession } from "@/hooks/use-session";
import { canUser } from "@/server/auth/rbac";
import { IntegrationCards } from "@/components/integrations/integration-cards";
import { GitHubPanel } from "@/components/integrations/github-panel";
import { WhatsAppPanel } from "@/components/integrations/whatsapp-panel";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function GitHubReturnNotice() {
  const params = useSearchParams();
  const result = params.get("github");
  if (!result) return null;
  const message =
    result === "connected" ? "GitHub conectado com sucesso." : result === "invalid" ? "Não foi possível validar o retorno do GitHub. Tente conectar novamente." : (params.get("message") ?? "Erro ao conectar o GitHub.");
  const ok = result === "connected";
  return <p className={`mb-4 rounded-md border px-3 py-2 text-sm ${ok ? "border-status-running/40 text-status-running" : "border-status-error/40 text-status-error"}`}>{message}</p>;
}

export default function IntegrationsPage() {
  const { data: user, isLoading } = useSession();
  const allowed = user ? canUser(user, "integration:manage") : false;

  if (!isLoading && !allowed) return <p className="text-sm text-muted">Somente administradores podem gerenciar integrações.</p>;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Configurações</p>
        <h2 className="text-xl font-semibold">Integrações</h2>
      </div>
      <Suspense>
        <GitHubReturnNotice />
      </Suspense>
      <IntegrationCards />
      <GitHubPanel />
      <WhatsAppPanel />
    </div>
  );
}
