"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useSession } from "@/hooks/use-session";
import { useClientDetail } from "@/hooks/use-billing";
import { canUser } from "@/server/auth/rbac";
import { formatPhoneBR } from "@/lib/phone";
import { formatBRL } from "@/lib/money";
import { formatCivilBR } from "@/lib/civil-date";
import { ClientFormDialog } from "@/components/billing/client-form-dialog";
import { ChargeFormDialog } from "@/components/billing/charge-form-dialog";
import { ChargeDrawer } from "@/components/billing/charge-drawer";
import { formatDateTimeBR } from "@/components/billing/status";

const CHARGE_STATUS: Record<string, string> = { PENDING: "Pendente", PAID: "Paga", CANCELLED: "Cancelada" };

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: user } = useSession();
  const canManage = user ? canUser(user, "billing:manage") : false;
  const { data: client, isLoading, error } = useClientDetail(id);
  const [openCharge, setOpenCharge] = useState<string | null>(null);

  if (error) return <div className="min-h-screen bg-background p-6 text-sm text-muted">Você não tem acesso a este cliente.</div>;
  if (isLoading || !client) return <div className="min-h-screen bg-background p-6 text-sm text-muted">Carregando…</div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <Link href="/clients" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">← Clientes</Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-lg font-semibold">{client.tradeName ?? client.name}</h1>
          {canManage && (
            <div className="flex gap-2">
              <ClientFormDialog client={client} />
              <ChargeFormDialog defaultClientId={client.id} />
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="p-4"><p className="text-[11px] uppercase tracking-wider text-muted">Total recebido</p><p className="mt-2 text-lg font-semibold text-status-running">{formatBRL(client.totals.receivedCents)}</p></Card>
          <Card className="p-4"><p className="text-[11px] uppercase tracking-wider text-muted">Total pendente</p><p className="mt-2 text-lg font-semibold">{formatBRL(client.totals.pendingCents)}</p></Card>
          <Card className="p-4"><p className="text-[11px] uppercase tracking-wider text-muted">Total vencido</p><p className="mt-2 text-lg font-semibold text-status-error">{formatBRL(client.totals.overdueCents)}</p></Card>
          <Card className="p-4"><p className="text-[11px] uppercase tracking-wider text-muted">Próximo vencimento</p><p className="mt-2 text-lg font-semibold">{client.totals.nextDueDate ? formatCivilBR(client.totals.nextDueDate) : "—"}</p></Card>
        </div>

        <section>
          <h2 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Contato</h2>
          <Card className="grid gap-2 p-4 text-sm sm:grid-cols-2">
            <p><span className="text-muted">WhatsApp:</span> {client.whatsapp ? formatPhoneBR(client.whatsapp) : "—"}</p>
            <p><span className="text-muted">Telefone:</span> {client.phone ? formatPhoneBR(client.phone) : "—"}</p>
            <p><span className="text-muted">E-mail:</span> {client.email ?? "—"}</p>
            <p><span className="text-muted">Documento:</span> {client.document ?? "—"}</p>
            {client.notes && <p className="sm:col-span-2"><span className="text-muted">Observações:</span> {client.notes}</p>}
          </Card>
        </section>

        <section>
          <h2 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Projetos</h2>
          <div className="flex flex-wrap gap-2">
            {client.projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="rounded-full border border-border px-3 py-1 text-sm hover:border-accent/50">{p.name}</Link>
            ))}
            {client.projects.length === 0 && <p className="text-sm text-muted">Nenhum projeto vinculado.</p>}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Cobranças</h2>
          <Card className="divide-y divide-border">
            {client.charges.map((c) => (
              <button key={c.id} onClick={() => setOpenCharge(c.id)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-surface-raised">
                <span className="truncate">{c.description}</span>
                <span className="ml-4 shrink-0 text-muted">{formatCivilBR(c.dueDate)} · {formatBRL(c.amountCents)} · {CHARGE_STATUS[c.status]}</span>
              </button>
            ))}
            {client.charges.length === 0 && <p className="p-4 text-sm text-muted">Nenhuma cobrança.</p>}
          </Card>
        </section>

        <section>
          <h2 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Histórico de mensagens</h2>
          <Card className="divide-y divide-border">
            {client.messages.map((m) => (
              <div key={m.id} className="px-4 py-2.5 text-sm">
                <div className="flex justify-between text-xs text-muted"><span>{formatDateTimeBR(m.createdAt)} · {m.kind === "MANUAL" ? "manual" : "automática"}</span><span>{m.status === "SENT" ? "✓ Enviada" : m.status === "FAILED" ? "Falhou" : "Enviando"}</span></div>
                <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs">{m.body}</p>
              </div>
            ))}
            {client.messages.length === 0 && <p className="p-4 text-sm text-muted">Nenhuma mensagem enviada.</p>}
          </Card>
        </section>
      </main>
      <ChargeDrawer chargeId={openCharge} onClose={() => setOpenCharge(null)} />
    </div>
  );
}
