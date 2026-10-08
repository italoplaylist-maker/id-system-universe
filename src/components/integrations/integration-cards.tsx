"use client";

import { GitBranch, Server, MessageCircle, Boxes } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { useIntegrations } from "@/hooks/use-integrations";
import type { IntegrationState } from "@/server/integrations/overview";

const STATE_LABEL: Record<IntegrationState, string> = { CONNECTED: "CONECTADO", DISCONNECTED: "DESCONECTADO", PROBLEM: "COM PROBLEMA" };
const STATE_CLASS: Record<IntegrationState, string> = {
  CONNECTED: "border-status-running/40 bg-status-running/10 text-status-running",
  DISCONNECTED: "border-border bg-surface-raised text-muted",
  PROBLEM: "border-status-error/40 bg-status-error/10 text-status-error",
};
const ICONS = { github: GitBranch, coolify: Boxes, whatsapp: MessageCircle, servers: Server } as const;

export function IntegrationCards() {
  const { data, isLoading } = useIntegrations();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {isLoading && <p className="text-sm text-muted">Carregando…</p>}
      {data?.map((card) => {
        const Icon = ICONS[card.key];
        return (
          <Card key={card.key} className="p-4">
            <div className="flex items-center justify-between">
              <Icon className="h-5 w-5 text-muted" />
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider", STATE_CLASS[card.state])}>{STATE_LABEL[card.state]}</span>
            </div>
            <h3 className="mt-3 text-sm font-semibold">{card.name}</h3>
            <p className="mt-1 text-xs text-muted">{card.detail}</p>
          </Card>
        );
      })}
    </div>
  );
}
