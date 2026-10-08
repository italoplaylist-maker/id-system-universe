"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ApiClientError } from "@/lib/api-client";
import { useProjects } from "@/hooks/use-projects";
import { useCreateClient, useUpdateClient, type ClientInput } from "@/hooks/use-billing";
import type { ClientView } from "@/server/billing/client-service";

function ClientForm({ client, onDone }: { client?: ClientView; onDone: () => void }) {
  const { data: projects } = useProjects();
  const create = useCreateClient();
  const update = useUpdateClient(client?.id ?? "");
  const [form, setForm] = useState<ClientInput>({
    name: client?.name ?? "",
    tradeName: client?.tradeName ?? "",
    document: client?.document ?? "",
    phone: client?.phone ?? "",
    whatsapp: client?.whatsapp ?? "",
    email: client?.email ?? "",
    notes: client?.notes ?? "",
    projectIds: client?.projectIds ?? [],
  });
  const set = (patch: Partial<ClientInput>) => setForm((f) => ({ ...f, ...patch }));
  const busy = create.isPending || update.isPending;

  async function submit() {
    try {
      if (client) await update.mutateAsync(form);
      else await create.mutateAsync(form);
      toast.success(client ? "Cliente atualizado." : "Cliente cadastrado.");
      onDone();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Não foi possível salvar o cliente.");
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Nome / Razão social *">
        <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome fantasia">
          <Input value={form.tradeName ?? ""} onChange={(e) => set({ tradeName: e.target.value })} />
        </Field>
        <Field label="Documento (CPF/CNPJ)">
          <Input value={form.document ?? ""} onChange={(e) => set({ document: e.target.value })} />
        </Field>
        <Field label="WhatsApp" hint="Usado nas cobranças. Ex.: (11) 99999-8888">
          <Input value={form.whatsapp ?? ""} onChange={(e) => set({ whatsapp: e.target.value })} inputMode="tel" />
        </Field>
        <Field label="Telefone">
          <Input value={form.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" />
        </Field>
      </div>
      <Field label="E-mail">
        <Input type="email" value={form.email ?? ""} onChange={(e) => set({ email: e.target.value })} />
      </Field>
      <div>
        <span className="mb-1 block text-xs text-muted">Projetos / sistemas do cliente</span>
        <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {projects?.map((project) => (
            <label key={project.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.projectIds?.includes(project.id) ?? false}
                onChange={(e) => set({ projectIds: e.target.checked ? [...(form.projectIds ?? []), project.id] : (form.projectIds ?? []).filter((id) => id !== project.id) })}
              />
              {project.name}
            </label>
          ))}
          {projects?.length === 0 && <p className="text-xs text-muted">Nenhum projeto disponível.</p>}
        </div>
      </div>
      <Field label="Observações">
        <textarea
          value={form.notes ?? ""}
          onChange={(e) => set({ notes: e.target.value })}
          rows={2}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
        />
      </Field>
      <Button variant="primary" className="w-full" disabled={!form.name.trim() || busy} onClick={submit}>
        {busy ? "Salvando…" : "Salvar cliente"}
      </Button>
    </div>
  );
}

export function ClientFormDialog({ client }: { client?: ClientView }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {client ? (
          <Button variant="ghost" size="sm" aria-label="Editar cliente">
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
        ) : (
          <Button variant="primary" size="sm">
            <Plus className="h-4 w-4" /> Novo cliente
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={client ? "Editar cliente" : "Novo cliente"} className="max-h-[90vh] max-w-xl overflow-y-auto">
        {open && <ClientForm client={client} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
