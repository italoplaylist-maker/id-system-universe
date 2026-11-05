"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { currentSubscription, disablePush, enablePush, pushSupport, type PushSupport } from "@/lib/push-client";
import { useSession } from "@/hooks/use-session";
import { canUser } from "@/server/auth/rbac";

type Prefs = { deploys: boolean; agents: boolean; approvals: boolean; servers: boolean; billing: boolean };
const LABEL: Record<keyof Prefs, string> = {
  deploys: "Deploys (concluído / falhou)",
  agents: "Agentes (terminou / falhou)",
  approvals: "Pedidos de aprovação dos agentes",
  servers: "Servidores (caiu / voltou / alerta)",
  billing: "Financeiro (cobranças)",
};

/** Sino da barra superior: ativa os avisos neste aparelho (celular ou computador) e escolhe o que receber. */
export function NotificationsDialog() {
  const { data: user } = useSession();
  const [open, setOpen] = useState(false);
  const [support, setSupport] = useState<PushSupport>("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [devices, setDevices] = useState(0);

  const refresh = useCallback(async () => {
    setSupport(pushSupport());
    setSubscribed(!!(await currentSubscription().catch(() => null)));
    const r = await apiFetch<{ prefs: Prefs; devices: number }>("/api/notifications/preferences").catch(() => null);
    if (r) {
      setPrefs(r.prefs);
      setDevices(r.devices);
    }
  }, []);
  useEffect(() => {
    if (open) void refresh(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [open, refresh]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu certo.");
    } finally {
      setBusy(false);
      void refresh();
    }
  };
  const toggle = async (k: keyof Prefs) => {
    if (!prefs) return;
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    await apiFetch("/api/notifications/preferences", { method: "PUT", body: JSON.stringify(next) }).catch(() => setPrefs(prefs));
  };

  if (!user) return null;
  const showBilling = canUser(user, "billing:view");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="rounded-md p-2 text-muted hover:bg-surface-raised hover:text-foreground" aria-label="Notificações" title="Notificações">
          <Bell className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent title="Notificações" description="Pop-ups no app e avisos no celular e no computador, mesmo com o Universe fechado.">
        <div className="space-y-4 text-sm">
          <section className="space-y-2 rounded-md border border-border p-3">
            <p className="font-medium text-foreground">Este aparelho</p>
            {support === "needs-install" && (
              <p className="text-xs text-muted">No iPhone/iPad, primeiro instale o app: toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>, abra o Universe por esse ícone e volte aqui.</p>
            )}
            {support === "unsupported" && <p className="text-xs text-muted">Este navegador não oferece notificações push. Os pop-ups dentro do app continuam funcionando.</p>}
            {support === "denied" && <p className="text-xs text-status-warning">As notificações estão bloqueadas neste navegador. Libere nas configurações do site e tente de novo.</p>}
            {support === "ok" && (
              <div className="flex flex-wrap items-center gap-2">
                {subscribed ? (
                  <>
                    <span className="text-xs text-status-running">● Ativadas neste aparelho</span>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(disablePush, "Notificações desativadas neste aparelho.")}>Desativar</Button>
                  </>
                ) : (
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => run(enablePush, "Notificações ativadas neste aparelho.")}>Ativar neste aparelho</Button>
                )}
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await apiFetch("/api/notifications/test", { method: "POST" }); }, "Teste enviado.")}>Enviar teste</Button>
              </div>
            )}
            <p className="text-[11px] text-muted">{devices} aparelho{devices === 1 ? "" : "s"} ativo{devices === 1 ? "" : "s"} na sua conta. Faça isso em cada celular/computador que quiser avisar.</p>
          </section>
          <section className="space-y-2">
            <p className="font-medium text-foreground">O que avisar</p>
            {prefs &&
              (Object.keys(LABEL) as Array<keyof Prefs>)
                .filter((k) => k !== "billing" || showBilling)
                .map((k) => (
                  <label key={k} className="flex items-center justify-between gap-3 text-xs text-foreground">
                    {LABEL[k]}
                    <input type="checkbox" checked={prefs[k]} onChange={() => void toggle(k)} className="h-4 w-4 accent-[var(--accent,#e8283f)]" />
                  </label>
                ))}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
