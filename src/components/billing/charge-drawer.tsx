"use client";

import { useState } from "react";
import { toast } from "sonner";
import { X, Send, CheckCircle2, Ban, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApiClientError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { formatCivilBR, formatCompetence } from "@/lib/civil-date";
import { useChargeAction, useChargeDetail, useChargePreview, useChargeSend } from "@/hooks/use-billing";
import { useSession } from "@/hooks/use-session";
import { canUser } from "@/server/auth/rbac";
import { ChargeStatusPill, formatDateTimeBR } from "@/components/billing/status";

const REMINDER_LABEL: Record<string, string> = { PENDING: "Agendado", PROCESSING: "Enviando", SENT: "✓ Enviado", FAILED: "Falhou", SKIPPED: "Não enviado" };
const AUDIT_LABEL: Record<string, string> = {
  CHARGE_CREATED: "Cobrança criada",
  CHARGE_UPDATED: "Cobrança editada",
  CHARGE_AMOUNT_CHANGED: "Valor alterado",
  CHARGE_DUE_DATE_CHANGED: "Vencimento alterado",
  CHARGE_PAID: "Cobrança paga",
  CHARGE_PAYMENT_REVERSED: "Pagamento revertido",
  CHARGE_CANCELLED: "Cobrança cancelada",
  WHATSAPP_MESSAGE_SENT: "Mensagem enviada",
  WHATSAPP_MESSAGE_FAILED: "Mensagem falhou",
  WHATSAPP_MANUAL_SEND: "Envio manual",
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

function SendDialog({ chargeId, open, onOpenChange }: { chargeId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const preview = useChargePreview();
  const send = useChargeSend();
  const [message, setMessage] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  if (open && !loaded && !preview.isPending) {
    setLoaded(true);
    preview.mutate(chargeId, {
      onSuccess: ({ preview: p }) => {
        setMessage(p.body);
        setPhone(p.phone);
      },
      onError: (e) => toast.error(errorText(e, "Não foi possível gerar o preview.")),
    });
  }

  async function confirm() {
    try {
      const { result } = await send.mutateAsync({ id: chargeId, message: message ?? undefined });
      if (result.status === "SENT") toast.success("Mensagem enviada.");
      else toast.error(result.error ?? "O envio falhou.");
      onOpenChange(false);
      setLoaded(false);
    } catch (error) {
      toast.error(errorText(error, "Não foi possível enviar."));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setLoaded(false);
      }}
    >
      <DialogContent title="Enviar cobrança agora" description="Confira a mensagem antes de confirmar. O envio fica registrado no histórico.">
        <div className="space-y-3">
          <p className="text-xs text-muted">Para: {phone ? `+${phone}` : "cliente sem WhatsApp válido"}</p>
          <textarea
            value={message ?? ""}
            onChange={(e) => setMessage(e.target.value)}
            rows={9}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          />
          <Button variant="primary" className="w-full" disabled={!phone || !message?.trim() || send.isPending} onClick={confirm}>
            {send.isPending ? "Enviando…" : "Confirmar envio"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ChargeDrawer({ chargeId, onClose }: { chargeId: string | null; onClose: () => void }) {
  const { data: user } = useSession();
  const { data: charge } = useChargeDetail(chargeId);
  const action = useChargeAction(chargeId ?? "");
  const [sendOpen, setSendOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmReverse, setConfirmReverse] = useState(false);
  const [method, setMethod] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const canManage = user ? canUser(user, "billing:manage") : false;

  if (!chargeId) return null;
  const pending = charge && charge.status !== "PAGA" && charge.status !== "CANCELADA";

  async function run(kind: "pay" | "reverse" | "cancel", body?: Record<string, unknown>, ok = "Feito.") {
    try {
      await action.mutateAsync({ action: kind, body });
      toast.success(ok);
    } catch (error) {
      toast.error(errorText(error, "Não foi possível concluir."));
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-lg flex-col border-l border-border bg-surface-raised shadow-2xl">
      <div className="flex items-start justify-between border-b border-border p-4">
        <div>
          <h2 className="text-lg font-semibold">{charge?.clientName ?? "…"}</h2>
          {charge && <p className="text-sm text-muted">{charge.description}</p>}
          {charge && (
            <div className="mt-2">
              <ChargeStatusPill status={charge.status} daysOverdue={charge.daysOverdue} />
            </div>
          )}
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface hover:text-foreground" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>

      {charge && (
        <div className="flex-1 space-y-6 overflow-y-auto p-4 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-muted">Valor</dt>
              <dd className="text-base font-semibold">{formatBRL(charge.amountCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Vencimento</dt>
              <dd>{formatCivilBR(charge.dueDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Projeto</dt>
              <dd>{charge.projectName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Competência</dt>
              <dd>{formatCompetence(charge.competence) || "—"}</dd>
            </div>
            {charge.recurrence && (
              <div className="col-span-2">
                <dt className="text-xs text-muted">Recorrência</dt>
                <dd>{charge.recurrence.period.toLowerCase()} · {charge.recurrence.status === "ACTIVE" ? "ativa" : charge.recurrence.status === "PAUSED" ? "pausada" : "encerrada"}</dd>
              </div>
            )}
            {charge.notes && (
              <div className="col-span-2">
                <dt className="text-xs text-muted">Observações</dt>
                <dd>{charge.notes}</dd>
              </div>
            )}
          </dl>

          {canManage && (
            <div className="flex flex-wrap gap-2">
              {pending && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setSendOpen(true)}>
                    <Send className="h-3.5 w-3.5" /> Enviar agora
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => setPayOpen(true)}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Marcar como paga
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setConfirmCancel(true)}>
                    <Ban className="h-3.5 w-3.5" /> Cancelar
                  </Button>
                </>
              )}
              {charge.status === "PAGA" && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmReverse(true)}>
                  <Undo2 className="h-3.5 w-3.5" /> Reverter pagamento
                </Button>
              )}
            </div>
          )}

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Régua de cobrança</h3>
            <ul className="space-y-1">
              {charge.rules.map((rule) => (
                <li key={rule.id} className="flex justify-between text-sm">
                  <span className={rule.enabled ? "" : "text-muted line-through"}>{rule.description}</span>
                  <span className="text-muted">{rule.sendTime}</span>
                </li>
              ))}
              {charge.rules.length === 0 && <li className="text-muted">Sem avisos automáticos.</li>}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Histórico de avisos</h3>
            <ul className="space-y-2">
              {charge.reminders.map((r) => (
                <li key={r.id} className="rounded-md border border-border px-3 py-2">
                  <div className="flex justify-between">
                    <span>{formatDateTimeBR(r.scheduledAt)}</span>
                    <span className={r.status === "SENT" ? "text-status-running" : r.status === "FAILED" ? "text-status-error" : "text-muted"}>{REMINDER_LABEL[r.status]}</span>
                  </div>
                  <p className="text-xs text-muted">
                    WhatsApp · {r.description}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                </li>
              ))}
              {charge.reminders.length === 0 && <li className="text-muted">Nenhum aviso agendado.</li>}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Mensagens enviadas</h3>
            <ul className="space-y-2">
              {charge.messages.map((m) => (
                <li key={m.id} className="rounded-md border border-border px-3 py-2">
                  <div className="flex justify-between text-xs text-muted">
                    <span>{formatDateTimeBR(m.sentAt ?? m.createdAt)} · {m.kind === "MANUAL" ? "manual" : "automático"}</span>
                    <span className={m.status === "SENT" ? "text-status-running" : m.status === "FAILED" ? "text-status-error" : ""}>{m.status === "SENT" ? "✓ Enviada" : m.status === "FAILED" ? "Falhou" : "Enviando"}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs">{m.body}</p>
                  {m.error && <p className="mt-1 text-xs text-status-error">{m.error}</p>}
                </li>
              ))}
              {charge.messages.length === 0 && <li className="text-muted">Nenhuma mensagem enviada.</li>}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Pagamentos</h3>
            <ul className="space-y-1">
              {charge.payments.map((p) => (
                <li key={p.id} className={`flex justify-between ${p.reversed ? "text-muted line-through" : ""}`}>
                  <span>{formatCivilBR(p.paidAt)}{p.method ? ` · ${p.method}` : ""}</span>
                  <span>{formatBRL(p.amountCents)}</span>
                </li>
              ))}
              {charge.payments.length === 0 && <li className="text-muted">Nenhum pagamento registrado.</li>}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Auditoria</h3>
            <ul className="space-y-1 text-xs">
              {charge.audit.map((a) => (
                <li key={a.id} className="flex justify-between text-muted">
                  <span>{AUDIT_LABEL[a.action] ?? a.action}{a.userEmail ? ` · ${a.userEmail}` : ""}</span>
                  <span>{formatDateTimeBR(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <SendDialog chargeId={chargeId} open={sendOpen} onOpenChange={setSendOpen} />
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent title="Marcar como paga" description="O pagamento é registrado e os avisos futuros desta cobrança são cancelados.">
          <div className="space-y-3">
            <Field label="Forma de pagamento (opcional)">
              <Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="PIX, boleto, transferência…" />
            </Field>
            <Field label="Observação (opcional)">
              <Input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
            </Field>
            <Button
              variant="primary"
              className="w-full"
              disabled={action.isPending}
              onClick={async () => {
                await run("pay", { method: method || null, notes: payNotes || null }, "Pagamento registrado.");
                setPayOpen(false);
              }}
            >
              Confirmar pagamento
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={confirmCancel} onOpenChange={setConfirmCancel} title="Cancelar esta cobrança?" description="Os avisos futuros serão cancelados. O histórico é mantido." confirmLabel="Cancelar cobrança" danger onConfirm={() => run("cancel", undefined, "Cobrança cancelada.")} />
      <ConfirmDialog open={confirmReverse} onOpenChange={setConfirmReverse} title="Reverter o pagamento?" description="A cobrança volta a ficar pendente. O pagamento anterior continua no histórico." confirmLabel="Reverter" onConfirm={() => run("reverse", undefined, "Pagamento revertido.")} />
    </div>
  );
}
