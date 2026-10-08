"use client";

import { useState } from "react";
import { toast } from "sonner";
import { GitBranch, RefreshCw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApiClientError } from "@/lib/api-client";
import { useConnectGitHub, useGitHubIntegration, useRemoveGitHubInstallation, useSyncGitHub, useUpdateGitHubConfig } from "@/hooks/use-integrations";

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

export function GitHubPanel() {
  const { data } = useGitHubIntegration();
  const update = useUpdateGitHubConfig();
  const connect = useConnectGitHub();
  const sync = useSyncGitHub();
  const remove = useRemoveGitHubInstallation();
  const [appId, setAppId] = useState("");
  const [appSlug, setAppSlug] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const config = data?.config;

  async function save() {
    try {
      await update.mutateAsync({
        ...(appId ? { appId } : {}),
        ...(appSlug ? { appSlug } : {}),
        ...(privateKey ? { privateKey } : {}),
        ...(webhookSecret ? { webhookSecret } : {}),
      });
      setPrivateKey("");
      setWebhookSecret("");
      toast.success("Configuração do GitHub App salva.");
    } catch (error) {
      toast.error(errorText(error, "Não foi possível salvar."));
    }
  }

  async function startConnect() {
    try {
      const { url } = await connect.mutateAsync();
      window.location.href = url;
    } catch (error) {
      toast.error(errorText(error, "Não foi possível iniciar a conexão."));
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          <h3 className="text-sm font-semibold">GitHub App — ID System Universe</h3>
        </div>
        <Button variant="primary" size="sm" disabled={!config?.configured || connect.isPending} onClick={startConnect}>
          Conectar GitHub
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <section>
          <h4 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Contas conectadas</h4>
          {data?.installations.length === 0 && <p className="text-sm text-muted">Nenhuma conta conectada ainda. Configure o App abaixo e clique em “Conectar GitHub”.</p>}
          <div className="divide-y divide-border rounded-md border border-border">
            {data?.installations.map((installation) => (
              <div key={installation.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{installation.accountLogin}</p>
                  <p className="text-xs text-muted">
                    {installation.repositoryCount} repositório(s) autorizado(s) · {installation.status === "ACTIVE" ? "ativa" : installation.status === "SUSPENDED" ? "suspensa" : "removida"}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => sync.mutate(undefined, { onSuccess: () => toast.success("Repositórios sincronizados."), onError: (e) => toast.error(errorText(e, "Falha ao sincronizar.")) })} aria-label="Sincronizar repositórios">
                    <RefreshCw className={`h-3.5 w-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(installation.id)} aria-label="Remover vínculo">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-xs uppercase tracking-[0.2em] text-muted">Credenciais do App (somente servidor)</h4>
          <p className="text-xs text-muted">
            Os segredos ficam criptografados no servidor e nunca são exibidos novamente. Webhook:{" "}
            <code className="rounded bg-surface-raised px-1">/api/webhooks/github</code> · Setup URL: <code className="rounded bg-surface-raised px-1">/api/integrations/github/callback</code>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="App ID" hint={config?.appId ? `Atual: ${config.appId}` : undefined}>
              <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder={config?.appId ?? "123456"} inputMode="numeric" />
            </Field>
            <Field label="Slug do App" hint="O nome na URL github.com/apps/<slug>">
              <Input value={appSlug} onChange={(e) => setAppSlug(e.target.value)} placeholder={config?.appSlug ?? "id-system-universe"} />
            </Field>
          </div>
          <Field label="Chave privada (PEM)" hint={config?.hasPrivateKey ? "Já configurada — preencha apenas para substituir." : undefined}>
            <textarea
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              rows={4}
              placeholder={config?.hasPrivateKey ? "••••••••" : "-----BEGIN RSA PRIVATE KEY-----"}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </Field>
          <Field label="Segredo do webhook" hint={config?.hasWebhookSecret ? "Já configurado — preencha apenas para substituir." : undefined}>
            <Input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder={config?.hasWebhookSecret ? "••••••••" : ""} autoComplete="off" />
          </Field>
          <Button variant="primary" size="sm" onClick={save} disabled={update.isPending || (!appId && !appSlug && !privateKey && !webhookSecret)}>
            Salvar credenciais
          </Button>
        </section>
      </CardContent>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover vínculo com esta conta?"
        description="Os repositórios deixam de aparecer e o Auto Deploy desses vínculos para de funcionar. Para desinstalar o App, use também o GitHub."
        confirmLabel="Remover vínculo"
        danger
        onConfirm={async () => {
          if (!removing) return;
          try {
            await remove.mutateAsync(removing);
            toast.success("Vínculo removido.");
          } catch (error) {
            toast.error(errorText(error, "Não foi possível remover."));
          }
        }}
      />
    </Card>
  );
}
