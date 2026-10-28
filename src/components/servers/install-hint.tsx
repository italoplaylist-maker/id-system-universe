"use client";

import { Card } from "@/components/ui/card";
import type { ServerOverview } from "@/hooks/use-servers";
import { RotateTokenButton } from "./server-dialogs";

export function InstallHint({ server }: { server: ServerOverview }) {
  return (
    <Card className="space-y-3 p-6">
      <p className="text-sm text-foreground">Este servidor ainda não enviou métricas.</p>
      <p className="text-sm text-muted">
        Instale o agente na VPS. O token só é exibido na criação; se não o guardou, gere um novo — o comando de instalação aparece em seguida.
      </p>
      <RotateTokenButton serverId={server.id} />
    </Card>
  );
}
