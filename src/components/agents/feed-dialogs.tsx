"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Plug, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAgentFeedMutations, useAgentFeeds } from "@/hooks/use-agents";
import { formatAgo } from "@/lib/format-metrics";

const HOOK_CMD = "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/isu-hook.py\"";
const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "Notification", "SessionEnd"];

const entry = (matcher?: string) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: HOOK_CMD }] }];

export const SETTINGS_SNIPPET = JSON.stringify(
  { hooks: Object.fromEntries(EVENTS.map((e) => [e, entry(e.endsWith("ToolUse") ? "*" : undefined)])) },
  null,
  2,
);

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">{label}</p>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted hover:text-foreground"
          onClick={async () => {
            await navigator.clipboard.writeText(text).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-background p-3 text-xs text-foreground">{text}</pre>
    </div>
  );
}

export function FeedInstructions({ token }: { token: string }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="space-y-4 text-sm">
      <p className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-xs text-status-warning">
        Guarde o token agora: ele não é exibido de novo. Se perder, gere um novo (o antigo deixa de funcionar).
      </p>
      <div className="space-y-1.5">
        <p className="font-medium text-foreground">1. Variáveis do ambiente de nuvem</p>
        <p className="text-xs text-muted">No ambiente (menu do ambiente na barra de título → Editar), adicione e libere o domínio do painel em Acesso à rede:</p>
      </div>
      <CopyBlock label="Variáveis" text={`ISU_URL=${origin}\nISU_CLAUDE_TOKEN=${token}`} />
      <div className="space-y-1.5">
        <p className="font-medium text-foreground">2. Script do hook no repositório</p>
        <p className="text-xs text-muted">
          Salve em <code>.claude/hooks/isu-hook.py</code> (baixe de <a className="underline" href="/api/claude/hook" target="_blank" rel="noreferrer">/api/claude/hook</a>). Ele envia só o tipo do evento, a ferramenta e um alvo curto — nunca o texto do prompt, o conteúdo dos arquivos ou a saída dos comandos.
        </p>
      </div>
      <CopyBlock label="Comando para baixar" text={`mkdir -p .claude/hooks && curl -fsSL ${origin}/api/claude/hook -o .claude/hooks/isu-hook.py`} />
      <div className="space-y-1.5">
        <p className="font-medium text-foreground">3. Registrar os hooks</p>
        <p className="text-xs text-muted">Em <code>.claude/settings.json</code> do repositório (mescle com o que já existir):</p>
      </div>
      <CopyBlock label=".claude/settings.json" text={SETTINGS_SNIPPET} />
      <p className="text-xs text-muted">Novas sessões desse repositório passam a aparecer na sala em segundos.</p>
    </div>
  );
}

export function FeedsDialog() {
  const { data: feeds } = useAgentFeeds();
  const { create, rotate, remove } = useAgentFeedMutations();
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);
  const [toRotate, setToRotate] = useState<string | null>(null);

  return (
    <Dialog onOpenChange={(open) => !open && (setToken(null), setName(""))}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary"><Plug className="h-3.5 w-3.5" />Fontes</Button>
      </DialogTrigger>
      <DialogContent title={token ? "Conectar o hook" : "Fontes de agentes"} description={token ? undefined : "Cada fonte tem um token próprio, usado pelo hook do Claude Code."} className="max-w-xl">
        {token ? (
          <FeedInstructions token={token} />
        ) : (
          <div className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  setToken((await create.mutateAsync(name)).feed.token);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Falha ao criar a fonte.");
                }
              }}
            >
              <Input placeholder="Ex.: Sessões na nuvem" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome da fonte" />
              <Button type="submit" variant="primary" disabled={name.trim().length < 2 || create.isPending}>Criar</Button>
            </form>
            <ul className="divide-y divide-border rounded-md border border-border text-sm">
              {feeds?.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-foreground">{f.name}</p>
                    <p className="text-xs text-muted">{f.lastEventAt ? `último evento ${formatAgo(f.lastEventAt)}` : "nenhum evento ainda"}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setToRotate(f.id)} aria-label={`Novo token de ${f.name}`}><KeyRound className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setToDelete({ id: f.id, name: f.name })} aria-label={`Remover ${f.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </li>
              ))}
              {feeds?.length === 0 && <li className="px-3 py-3 text-muted">Nenhuma fonte ainda.</li>}
            </ul>
          </div>
        )}
        <ConfirmDialog
          open={toRotate !== null}
          onOpenChange={(o) => !o && setToRotate(null)}
          title="Gerar novo token?"
          description="O hook com o token antigo deixa de enviar eventos até ser atualizado."
          confirmLabel="Gerar token"
          onConfirm={async () => {
            if (toRotate) setToken((await rotate.mutateAsync(toRotate)).token);
          }}
        />
        <ConfirmDialog
          open={toDelete !== null}
          onOpenChange={(o) => !o && setToDelete(null)}
          title={`Remover ${toDelete?.name ?? ""}?`}
          description="As sessões e o histórico dessa fonte são apagados."
          confirmLabel="Remover"
          danger
          onConfirm={async () => {
            if (toDelete) await remove.mutateAsync(toDelete.id);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
