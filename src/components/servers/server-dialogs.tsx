"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useServerMutations } from "@/hooks/use-servers";

function installCommand(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `curl -fsSL ${origin}/api/agent/script -o isu-agent.sh && sudo ISU_URL=${origin} ISU_TOKEN=${token} bash isu-agent.sh --install`;
}

export function InstallInstructions({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const command = installCommand(token);
  return (
    <div className="space-y-3 text-sm">
      <p className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-xs text-status-warning">
        Guarde o comando agora: o token não é exibido novamente. Se perder, gere um novo token (o antigo deixa de funcionar).
      </p>
      <p className="text-muted">Execute na VPS (Linux, como root ou com sudo; requer bash e curl — Docker é opcional):</p>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-background p-3 text-xs text-foreground">{command}</pre>
      <Button
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(command).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copiado" : "Copiar comando"}
      </Button>
      <p className="text-xs text-muted">O agente envia métricas a cada 15 s e roda como serviço systemd (isu-agent). Em poucos segundos o servidor aparece online.</p>
    </div>
  );
}

export function AddServerDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const { create } = useServerMutations();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setName("");
          setToken(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="primary"><Plus className="h-3.5 w-3.5" />Adicionar servidor</Button>
      </DialogTrigger>
      <DialogContent title={token ? "Instalar o agente" : "Novo servidor"} description={token ? undefined : "Dê um nome à VPS. Você receberá o comando de instalação do agente."} className="max-w-xl">
        {token ? (
          <InstallInstructions token={token} />
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const result = await create.mutateAsync(name);
                setToken(result.server.token);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Falha ao criar o servidor.");
              }
            }}
          >
            <Input autoFocus placeholder="Ex.: VPS Produção" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do servidor" />
            <Button type="submit" variant="primary" disabled={name.trim().length < 2 || create.isPending}>Criar e gerar comando</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RotateTokenButton({ serverId }: { serverId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { rotate } = useServerMutations();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}><KeyRound className="h-3.5 w-3.5" />Novo token</Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Gerar novo token?"
        description="O agente instalado deixa de enviar métricas até ser reinstalado com o novo token."
        confirmLabel="Gerar token"
        onConfirm={async () => {
          try {
            setToken((await rotate.mutateAsync(serverId)).token);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Falha ao gerar o token.");
          }
        }}
      />
      <Dialog open={token !== null} onOpenChange={(o) => !o && setToken(null)}>
        <DialogContent title="Novo token gerado" className="max-w-xl">{token && <InstallInstructions token={token} />}</DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteServerButton({ serverId, name, onDeleted }: { serverId: string; name: string; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const { remove } = useServerMutations();
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setConfirm(true)}><Trash2 className="h-3.5 w-3.5" />Remover</Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Remover ${name}?`}
        description="O histórico de métricas deste servidor será apagado. O agente na VPS continua instalado — desinstale-o por lá."
        confirmLabel="Remover"
        danger
        onConfirm={async () => {
          try {
            await remove.mutateAsync(serverId);
            onDeleted();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Falha ao remover.");
          }
        }}
      />
    </>
  );
}
