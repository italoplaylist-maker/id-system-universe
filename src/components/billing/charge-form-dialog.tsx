"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ApiClientError } from "@/lib/api-client";
import { parseBRLToCents } from "@/lib/money";
import { DEFAULT_REMINDER_RULES, RECURRENCE_PERIOD_LABEL, type ReminderRuleInput } from "@/lib/billing-defaults";
import { useProjects } from "@/hooks/use-projects";
import { useClients, useCreateCharge, useReasons } from "@/hooks/use-billing";
import { RuleEditor } from "@/components/billing/rule-editor";

const NEW_REASON = "__new__";
const PERIODS = Object.keys(RECURRENCE_PERIOD_LABEL) as (keyof typeof RECURRENCE_PERIOD_LABEL)[];

function ChargeForm({ defaultClientId, defaultProjectId, onDone }: { defaultClientId?: string; defaultProjectId?: string; onDone: () => void }) {
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const { data: reasons } = useReasons();
  const create = useCreateCharge();

  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [reasonChoice, setReasonChoice] = useState("");
  const [newReason, setNewReason] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [whatsapp, setWhatsapp] = useState(true);
  const [recurrent, setRecurrent] = useState(false);
  const [period, setPeriod] = useState<keyof typeof RECURRENCE_PERIOD_LABEL>("MONTHLY");
  const [intervalDays, setIntervalDays] = useState("30");
  const [endDate, setEndDate] = useState("");
  const [rules, setRules] = useState<ReminderRuleInput[]>(DEFAULT_REMINDER_RULES);

  const cents = parseBRLToCents(amount);
  const ready = clientId && description.trim() && cents && dueDate && (!recurrent || period !== "CUSTOM" || Number(intervalDays) >= 1);

  function pickReason(value: string) {
    setReasonChoice(value);
    if (value && value !== NEW_REASON) {
      const reason = reasons?.find((r) => r.id === value);
      if (reason && !description.trim()) setDescription(reason.name);
    }
  }

  async function submit() {
    if (!cents) return;
    try {
      await create.mutateAsync({
        clientId,
        projectId: projectId || null,
        reasonId: reasonChoice && reasonChoice !== NEW_REASON ? reasonChoice : null,
        reasonName: reasonChoice === NEW_REASON ? newReason : null,
        description: description.trim(),
        amountCents: cents,
        dueDate,
        notes: notes.trim() || null,
        whatsappEnabled: whatsapp,
        rules,
        ...(recurrent ? { recurrence: { period, intervalDays: period === "CUSTOM" ? Number(intervalDays) : null, endDate: endDate || null } } : {}),
      });
      toast.success(recurrent ? "Recorrência criada." : "Cobrança criada.");
      onDone();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Não foi possível criar a cobrança.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cliente *">
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Selecione…</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.tradeName ?? c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Projeto / Sistema">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Nenhum</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Motivo">
        <Select value={reasonChoice} onChange={(e) => pickReason(e.target.value)}>
          <option value="">Texto livre</option>
          {reasons?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
          <option value={NEW_REASON}>+ Criar novo motivo…</option>
        </Select>
      </Field>
      {reasonChoice === NEW_REASON && (
        <Field label="Nome do novo motivo">
          <Input value={newReason} onChange={(e) => setNewReason(e.target.value)} />
        </Field>
      )}
      <Field label="Descrição / Motivo da cobrança *">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Manutenção mensal do sistema" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$) *" hint={amount && !cents ? "Valor inválido" : undefined}>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="800,00" inputMode="decimal" />
        </Field>
        <Field label={recurrent ? "Primeiro vencimento *" : "Vencimento *"}>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={recurrent} onChange={(e) => setRecurrent(e.target.checked)} /> Cobrança recorrente
      </label>
      {recurrent && (
        <div className="grid grid-cols-3 gap-3 rounded-md border border-border p-3">
          <Field label="Periodicidade">
            <Select value={period} onChange={(e) => setPeriod(e.target.value as keyof typeof RECURRENCE_PERIOD_LABEL)}>
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {RECURRENCE_PERIOD_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          {period === "CUSTOM" && (
            <Field label="A cada (dias)">
              <Input type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
            </Field>
          )}
          <Field label="Data final (opcional)" className={period === "CUSTOM" ? "" : "col-span-2"}>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <p className="col-span-3 text-xs text-muted">O dia do vencimento é o do primeiro vencimento. Sem data final, a recorrência continua até ser pausada ou encerrada.</p>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} /> Enviar avisos por WhatsApp
      </label>
      {whatsapp && <RuleEditor rules={rules} onChange={setRules} />}

      <Field label="Observações">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Button variant="primary" className="w-full" disabled={!ready || create.isPending} onClick={submit}>
        {create.isPending ? "Salvando…" : recurrent ? "Criar recorrência" : "Criar cobrança"}
      </Button>
    </div>
  );
}

export function ChargeFormDialog({ defaultClientId, defaultProjectId }: { defaultClientId?: string; defaultProjectId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <Plus className="h-4 w-4" /> Nova cobrança
        </Button>
      </DialogTrigger>
      <DialogContent title="Nova cobrança" className="max-h-[92vh] max-w-2xl overflow-y-auto">
        {open && <ChargeForm defaultClientId={defaultClientId} defaultProjectId={defaultProjectId} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
