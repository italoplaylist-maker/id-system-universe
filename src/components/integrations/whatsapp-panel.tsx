"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/select";
import { ApiClientError } from "@/lib/api-client";
import { useTestWhatsApp, useUpdateWhatsApp, useWhatsAppConfig } from "@/hooks/use-integrations";

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

export function WhatsAppPanel() {
  const { data: config } = useWhatsAppConfig();
  const update = useUpdateWhatsApp();
  const test = useTestWhatsApp();
  const [baseUrl, setBaseUrl] = useState("");
  const [instance, setInstance] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [timezone, setTimezone] = useState("");

  async function save() {
    try {
      await update.mutateAsync({
        ...(baseUrl ? { baseUrl } : {}),
        ...(instance ? { instance } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(timezone ? { timezone } : {}),
        ...(windowStart ? { windowStart } : {}),
        ...(windowEnd ? { windowEnd } : {}),
      });
      setApiKey("");
      toast.success("Configuração do WhatsApp salva.");
    } catch (error) {
      toast.error(errorText(error, "Não foi possível salvar."));
    }
  }

  async function runTest() {
    try {
      const { status } = await test.mutateAsync();
      if (status.connected) toast.success("WhatsApp conectado.");
      else toast.error(`WhatsApp sem conexão (${status.detail ?? "desconhecido"}).`);
    } catch (error) {
      toast.error(errorText(error, "Falha ao testar."));
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          <h3 className="text-sm font-semibold">WhatsApp — Evolution API</h3>
        </div>
        <Button variant="secondary" size="sm" onClick={runTest} disabled={!config?.configured || test.isPending}>
          Testar conexão
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted">A chave da API fica criptografada no servidor e nunca é exibida novamente. As cobranças usam o WhatsApp apenas como canal de envio.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="URL da API" hint={config?.baseUrl ? `Atual: ${config.baseUrl}` : undefined}>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={config?.baseUrl ?? "https://evolution.suaempresa.com"} />
          </Field>
          <Field label="Instância" hint={config?.instance ? `Atual: ${config.instance}` : undefined}>
            <Input value={instance} onChange={(e) => setInstance(e.target.value)} placeholder={config?.instance ?? "idsystem"} />
          </Field>
        </div>
        <Field label="API Key" hint={config?.hasApiKey ? "Já configurada — preencha apenas para substituir." : undefined}>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={config?.hasApiKey ? "••••••••" : ""} autoComplete="off" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Janela de envio — início">
            <Input type="time" value={windowStart || config?.windowStart || ""} onChange={(e) => setWindowStart(e.target.value)} />
          </Field>
          <Field label="Janela de envio — fim">
            <Input type="time" value={windowEnd || config?.windowEnd || ""} onChange={(e) => setWindowEnd(e.target.value)} />
          </Field>
          <Field label="Fuso horário">
            <Input value={timezone || config?.timezone || ""} onChange={(e) => setTimezone(e.target.value)} />
          </Field>
        </div>
        <Button variant="primary" size="sm" onClick={save} disabled={update.isPending}>
          Salvar
        </Button>
      </CardContent>
    </Card>
  );
}
