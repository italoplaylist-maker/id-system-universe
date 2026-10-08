"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useSession } from "@/hooks/use-session";
import { useClients } from "@/hooks/use-billing";
import { useProjects } from "@/hooks/use-projects";
import { canUser } from "@/server/auth/rbac";
import { formatPhoneBR } from "@/lib/phone";
import { ClientFormDialog } from "@/components/billing/client-form-dialog";

export default function ClientsPage() {
  const { data: user, isLoading: sessionLoading } = useSession();
  const canView = user ? canUser(user, "billing:view") : false;
  const canManage = user ? canUser(user, "billing:manage") : false;
  const { data: clients, isLoading } = useClients(canView);
  const { data: projects } = useProjects();
  const [q, setQ] = useState("");
  const names = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const filtered = clients?.filter((c) => `${c.name} ${c.tradeName ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  if (!sessionLoading && !canView) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">← Voltar ao Universe</Link>
        <p className="mt-4 text-sm text-muted">Você não tem acesso ao cadastro de clientes.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <Link href="/billing" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">← Central de Cobranças</Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Clientes</h1>
          {canManage && <ClientFormDialog />}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Input placeholder="Buscar cliente…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-6 max-w-xs" />
        {isLoading && <p className="text-sm text-muted">Carregando…</p>}
        {!isLoading && filtered?.length === 0 && <p className="text-sm text-muted">Nenhum cliente encontrado.</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered?.map((client) => (
            <Link key={client.id} href={`/clients/${client.id}`}>
              <Card className="p-4 transition-colors hover:border-accent/50">
                <p className="font-semibold">{client.tradeName ?? client.name}</p>
                {client.tradeName && <p className="text-xs text-muted">{client.name}</p>}
                <p className="mt-2 text-xs text-muted">{client.whatsapp ? formatPhoneBR(client.whatsapp) : "Sem WhatsApp"}</p>
                <p className="mt-1 truncate text-xs text-muted">{client.projectIds.map((id) => names.get(id)).filter(Boolean).join(", ") || "Sem projetos"}</p>
                {!client.active && <p className="mt-2 text-[10px] uppercase text-muted">Inativo</p>}
              </Card>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
