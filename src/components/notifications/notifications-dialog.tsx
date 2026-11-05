"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { currentSubscription, disablePush, enablePush, pushSupport, type PushSupport } from "@/lib/push-client";
import { useSession } from "@/hooks/use-session";
import { useUiStore } from "@/store/ui-store";
import { canUser } from "@/server/auth/rbac";

type Prefs = { deploys: boolean; agents: boolean; approvals: boolean; servers: boolean; billing: boolean };
interface Device {
  id: string;
  label: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}
interface PrefsResponse {
  prefs: Prefs;
  devices: Device[];
  whatsapp: { enabled: boolean; number: string; serviceConfigured: boolean };
}
interface TestResponse {
  push: Array<{ device: string; ok: boolean; detail?: string }>;
  whatsapp: { sent: boolean; ok?: boolean; detail?: string };
}

const LABEL: Record<keyof Prefs, string> = {
  deploys: "Deploys (concluído / falhou)",
  agents: "Agentes (terminou / falhou)",
  approvals: "Pedidos de aprovação dos agentes",
  servers: "Servidores (caiu / voltou / alerta)",
  billing: "Financeiro (cobranças)",
};

const ago = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca");

/** Sino: avisos no celular/computador mesmo com o Universe fechado (push) e/ou por WhatsApp. */
export function NotificationsDialog({ variant = "icon" }: { variant?: "icon" | "pill" }) {
  const { data: user } = useSession();
  const open = useUiStore((s) => s.notificationsOpen);
  const setOpen = useUiStore((s) => s.setNotificationsOpen);
  const [support, setSupport] = useState<PushSupport>("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<PrefsResponse | null>(null);
  const [number, setNumber] = useState("");
  const [testResult, setTestResult] = useState<TestResponse | null>(null);

  const refresh = useCallback(async () => {
    setSupport(pushSupport());
    setSubscribed(!!(await currentSubscription().catch(() => null)));
    const r = await apiFetch<PrefsResponse>("/api/notifications/preferences").catch(() => null);
    if (r) {
      setData(r);
      setNumber((n) => n || r.whatsapp.number);
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
  const put = async (body: Record<string, unknown>) => {
    const r = await apiFetch<PrefsResponse>("/api/notifications/preferences", { method: "PUT", body: JSON.stringify(body) });
    setData(r);
    return r;
  };
  const toggle = async (k: keyof Prefs) => {
    if (!data) return;
    setData({ ...data, prefs: { ...data.prefs, [k]: !data.prefs[k] } });
    await put({ [k]: !data.prefs[k] }).catch(() => void refresh());
  };
  const test = (channel: "push" | "whatsapp") =>
    run(async () => {
      const r = await apiFetch<TestResponse>("/api/notifications/test", { method: "POST", body: JSON.stringify({ channel }) });
      setTestResult(r);
      if (channel === "push" && r.push.length === 0) throw new Error("Nenhum aparelho ativado nesta conta ainda.");
      if (channel === "whatsapp" && !r.whatsapp.sent) throw new Error("Salve o número de WhatsApp primeiro.");
    }, "Teste enviado — veja o resultado abaixo.");

  if (!user) return null;
  const showBilling = canUser(user, "billing:view");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "pill" ? (
          <button className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised/80 px-3 py-1.5 text-xs text-muted backdrop-blur hover:text-foreground" aria-label="Notificações" title="Notificações">
            <Bell className="h-3.5 w-3.5" aria-hidden /> Notificações
          </button>
        ) : (
          <button className="rounded-md p-2 text-muted hover:bg-surface-raised hover:text-foreground" aria-label="Notificações" title="Notificações">
            <Bell className="h-4 w-4" />
          </button>
        )}
      </DialogTrigger>
      <DialogContent title="Notificações" description="Receba os avisos com o Universe fechado: push no aparelho e/ou WhatsApp.">
        <div className="max-h-[75vh] space-y-4 overflow-y-auto text-sm">
          <section className="space-y-2 rounded-md border border-border p-3">
            <p className="font-medium text-foreground">Push neste aparelho</p>
            {support === "needs-install" && (
              <div className="space-y-1 rounded border border-status-warning/40 bg-status-warning/10 p-2 text-xs text-status-warning">
                <p className="font-semibold">No iPhone/iPad o aviso com o app fechado só funciona com o app instalado:</p>
                <ol className="list-decimal pl-4">
                  <li>Abra o Universe no <b>Safari</b> (não em outro navegador).</li>
                  <li>Toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.</li>
                  <li>Abra o Universe pelo <b>ícone novo</b> e volte a este sino.</li>
                </ol>
              </div>
            )}
            {support === "unsupported" && <p className="text-xs text-muted">Este navegador não oferece push. Use o WhatsApp abaixo.</p>}
            {support === "denied" && <p className="text-xs text-status-warning">As notificações estão bloqueadas neste navegador. Libere nas configurações do site e tente de novo.</p>}
            {support === "ok" && (
              <div className="flex flex-wrap items-center gap-2">
                {subscribed ? (
                  <>
                    <span className="text-xs text-status-running">● Ativado neste aparelho</span>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(disablePush, "Desativado neste aparelho.")}>Desativar</Button>
                  </>
                ) : (
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => run(enablePush, "Ativado neste aparelho.")}>Ativar neste aparelho</Button>
                )}
              </div>
            )}
            {data && data.devices.length > 0 && (
              <ul className="space-y-1 text-[11px]">
                {data.devices.map((d) => (
                  <li key={d.id} className="flex flex-wrap justify-between gap-1 rounded border border-border bg-surface px-2 py-1">
                    <span className="text-foreground">{d.label}</span>
                    <span className={d.lastError ? "text-status-error" : "text-muted"}>{d.lastError ? `último erro: ${d.lastError}` : `última entrega: ${ago(d.lastSuccessAt)}`}</span>
                  </li>
                ))}
              </ul>
            )}
            {data && data.devices.length > 0 && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => test("push")}>Enviar teste de push</Button>
            )}
          </section>

          <section className="space-y-2 rounded-md border border-border p-3">
            <p className="font-medium text-foreground">WhatsApp <span className="text-[11px] font-normal text-muted">(chega em qualquer celular, sem instalar nada)</span></p>
            {data && !data.whatsapp.serviceConfigured ? (
              <p className="text-xs text-muted">O serviço de WhatsApp ainda não foi configurado em Configurações → Integrações.</p>
            ) : (
              <>
                <div className="flex gap-2">
                  <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Seu WhatsApp: (11) 91234-5678" inputMode="tel" className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none" />
                  <Button size="sm" variant="secondary" disabled={busy || !number.trim()} onClick={() => run(async () => { await put({ whatsappNumber: number }); }, "Número salvo.")}>Salvar</Button>
                </div>
                <label className="flex items-center justify-between gap-3 text-xs text-foreground">
                  Receber os avisos por WhatsApp
                  <input type="checkbox" checked={data?.whatsapp.enabled ?? false} disabled={busy} onChange={(e) => run(async () => { await put({ whatsappNumber: number || undefined, whatsappEnabled: e.target.checked }); }, e.target.checked ? "WhatsApp ligado." : "WhatsApp desligado.")} className="h-4 w-4" />
                </label>
                {data?.whatsapp.number && <Button size="sm" variant="secondary" disabled={busy} onClick={() => test("whatsapp")}>Enviar teste no WhatsApp</Button>}
              </>
            )}
          </section>

          {testResult && (
            <section className="space-y-1 rounded-md border border-border bg-surface p-3 text-xs" aria-live="polite">
              <p className="font-medium text-foreground">Resultado do teste</p>
              {testResult.push.map((p, i) => (
                <p key={i} className={p.ok ? "text-status-running" : "text-status-error"}>{p.device}: {p.ok ? "entregue ao serviço de push (deve aparecer em segundos)" : `falhou — ${p.detail ?? "erro"}`}</p>
              ))}
              {testResult.whatsapp.sent && <p className={testResult.whatsapp.ok ? "text-status-running" : "text-status-error"}>WhatsApp: {testResult.whatsapp.ok ? "enviado" : `falhou — ${testResult.whatsapp.detail ?? "erro"}`}</p>}
            </section>
          )}

          <section className="space-y-2">
            <p className="font-medium text-foreground">O que avisar</p>
            {data &&
              (Object.keys(LABEL) as Array<keyof Prefs>)
                .filter((k) => k !== "billing" || showBilling)
                .map((k) => (
                  <label key={k} className="flex items-center justify-between gap-3 text-xs text-foreground">
                    {LABEL[k]}
                    <input type="checkbox" checked={data.prefs[k]} onChange={() => void toggle(k)} className="h-4 w-4" />
                  </label>
                ))}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
