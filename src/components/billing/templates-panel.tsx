"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api-client";
import { TEMPLATE_VARIABLES } from "@/lib/billing-defaults";
import { useTemplatePreview, useTemplates, useUpdateTemplate } from "@/hooks/use-billing";

const KINDS = [
  { kind: "BEFORE", title: "Antes do vencimento" },
  { kind: "ON", title: "No vencimento" },
  { kind: "AFTER", title: "Após o vencimento" },
] as const;

function TemplateEditor({ kind, title, initial, canManage }: { kind: "BEFORE" | "ON" | "AFTER"; title: string; initial: string; canManage: boolean }) {
  const [body, setBody] = useState(initial);
  const [preview, setPreview] = useState<string | null>(null);
  const update = useUpdateTemplate();
  const previewMutation = useTemplatePreview();

  async function showPreview() {
    try {
      setPreview((await previewMutation.mutateAsync(body)).preview);
    } catch (error) {
      setPreview(null);
      toast.error(error instanceof ApiClientError ? error.message : "Mensagem inválida.");
    }
  }

  async function save() {
    try {
      await update.mutateAsync({ kind, body });
      toast.success("Mensagem salva.");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Não foi possível salvar.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold">{title}</h3>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setPreview(null);
          }}
          rows={8}
          readOnly={!canManage}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
        />
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={showPreview} disabled={previewMutation.isPending}>
            Pré-visualizar
          </Button>
          {canManage && (
            <Button variant="primary" size="sm" onClick={save} disabled={update.isPending || body === initial}>
              Salvar
            </Button>
          )}
        </div>
        {preview && <pre className="whitespace-pre-wrap rounded-md border border-status-running/30 bg-background p-3 text-xs">{preview}</pre>}
      </CardContent>
    </Card>
  );
}

export function TemplatesPanel({ canManage }: { canManage: boolean }) {
  const { data } = useTemplates();
  if (!data) return <p className="text-sm text-muted">Carregando…</p>;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Variáveis disponíveis: {TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join("  ")}. A pré-visualização usa dados de exemplo.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {KINDS.map(({ kind, title }) => (
          <TemplateEditor key={`${kind}-${data[kind]}`} kind={kind} title={title} initial={data[kind]} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}
