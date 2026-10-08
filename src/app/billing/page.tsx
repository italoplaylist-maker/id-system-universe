"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useSession } from "@/hooks/use-session";
import { useProjects } from "@/hooks/use-projects";
import { useBillingSummary, useCharges, useClients, type ChargeQuery } from "@/hooks/use-billing";
import { canUser } from "@/server/auth/rbac";
import { BillingDashboard } from "@/components/billing/dashboard";
import { ChargesTable } from "@/components/billing/charges-table";
import { ChargeDrawer } from "@/components/billing/charge-drawer";
import { ChargeFormDialog } from "@/components/billing/charge-form-dialog";
import { RecurrencesPanel } from "@/components/billing/recurrences-panel";
import { TemplatesPanel } from "@/components/billing/templates-panel";
import { WhatsAppHistory } from "@/components/billing/whatsapp-history";

type Tab = "dashboard" | "charges" | "recurrences" | "reminders" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "charges", label: "Cobranças" },
  { id: "recurrences", label: "Recorrências" },
  { id: "reminders", label: "Avisos" },
  { id: "history", label: "Histórico WhatsApp" },
];
const QUICK = [
  { id: "ALL", label: "Todas" },
  { id: "TODAY", label: "Hoje" },
  { id: "UPCOMING", label: "Próximas" },
  { id: "OVERDUE", label: "Vencidas" },
  { id: "PAID", label: "Pagas" },
] as const;

export default function BillingPage() {
  const { data: user, isLoading: sessionLoading } = useSession();
  const canView = user ? canUser(user, "billing:view") : false;
  const canManage = user ? canUser(user, "billing:manage") : false;

  const [tab, setTab] = useState<Tab>("dashboard");
  const [view, setView] = useState<string>("ALL");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [recurrent, setRecurrent] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [q, setQ] = useState("");
  const [openCharge, setOpenCharge] = useState<string | null>(null);

  const filters: ChargeQuery = {
    view: view === "ALL" ? undefined : view,
    clientId: clientId || undefined,
    projectId: projectId || undefined,
    recurrent: recurrent === "" ? undefined : recurrent === "true",
    dueFrom: dueFrom || undefined,
    dueTo: dueTo || undefined,
    q: q || undefined,
  };
  const summaryFilters: ChargeQuery = { clientId: filters.clientId, projectId: filters.projectId, recurrent: filters.recurrent, dueFrom: filters.dueFrom, dueTo: filters.dueTo };

  const { data: clients } = useClients(canView);
  const { data: projects } = useProjects();
  const { data: summary } = useBillingSummary(summaryFilters, canView);
  const { data: charges, isLoading } = useCharges(filters, canView && (tab === "charges" || tab === "dashboard"));

  if (!sessionLoading && !canView) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">← Voltar ao Universe</Link>
        <p className="mt-4 text-sm text-muted">Você não tem acesso à Central de Cobranças.</p>
      </div>
    );
  }

  const filterBar = (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="flex rounded-md border border-border p-0.5">
        {QUICK.map((item) => (
          <button key={item.id} onClick={() => setView(item.id)} className={cn("rounded px-3 py-1 text-xs", view === item.id ? "bg-accent text-black" : "text-muted hover:text-foreground")}>
            {item.label}
          </button>
        ))}
      </div>
      <Select className="h-9 w-44" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Cliente">
        <option value="">Todos os clientes</option>
        {clients?.map((c) => (
          <option key={c.id} value={c.id}>{c.tradeName ?? c.name}</option>
        ))}
      </Select>
      <Select className="h-9 w-44" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Projeto">
        <option value="">Todos os projetos</option>
        {projects?.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </Select>
      <Select className="h-9 w-48" value={recurrent} onChange={(e) => setRecurrent(e.target.value)} aria-label="Recorrência">
        <option value="">Recorrente: todas</option>
        <option value="true">Só recorrentes</option>
        <option value="false">Só avulsas</option>
      </Select>
      <Input className="h-9 w-40" type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} aria-label="Vencimento de" />
      <Input className="h-9 w-40" type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} aria-label="Vencimento até" />
      <Input className="h-9 w-44" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
      {(clientId || projectId || recurrent || dueFrom || dueTo || q || view !== "ALL") && (
        <Button variant="ghost" size="sm" onClick={() => { setView("ALL"); setClientId(""); setProjectId(""); setRecurrent(""); setDueFrom(""); setDueTo(""); setQ(""); }}>
          Limpar filtros
        </Button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">← Voltar ao Universe</Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Central de Cobranças</h1>
          <div className="flex items-center gap-2">
            <Link href="/clients" className="text-sm text-muted hover:text-foreground">Clientes</Link>
            {canManage && <ChargeFormDialog />}
          </div>
        </div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-border px-6">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === t.id ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {(tab === "dashboard" || tab === "charges") && filterBar}
        {tab === "dashboard" && (
          <>
            {summary ? <BillingDashboard summary={summary} /> : <p className="text-sm text-muted">Carregando…</p>}
            <h2 className="text-xs uppercase tracking-[0.2em] text-muted">Cobranças do filtro</h2>
            <ChargesTable items={charges?.items ?? []} onOpen={setOpenCharge} emptyText={isLoading ? "Carregando…" : "Nenhuma cobrança neste filtro."} />
          </>
        )}
        {tab === "charges" && <ChargesTable items={charges?.items ?? []} onOpen={setOpenCharge} emptyText={isLoading ? "Carregando…" : "Nenhuma cobrança encontrada."} />}
        {tab === "recurrences" && <RecurrencesPanel canManage={canManage} />}
        {tab === "reminders" && <TemplatesPanel canManage={canManage} />}
        {tab === "history" && <WhatsAppHistory />}
      </main>

      <ChargeDrawer chargeId={openCharge} onClose={() => setOpenCharge(null)} />
    </div>
  );
}
