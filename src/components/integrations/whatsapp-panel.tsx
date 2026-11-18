"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/select";
import { ApiClientError } from "@/lib/api-client";
import { useDisconnectWhatsApp, useStartWhatsAppConnection, useTestWhatsApp, useUpdateWhatsApp, useWhatsAppConfig, useWhatsAppConnection, type WhatsAppConnectionView } from "@/hooks/use-integrations";

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

export function WhatsAppPanel() {
  const { data: config } = useWhatsAppConfig();
  const update = useUpdateWhatsApp();
  const test = useTestWhatsApp();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [timezone, setTimezone] = useState("");
  const start = useStartWhatsAppConnection();
  const disconnect = useDisconnectWhatsApp();
  const [connecting, setConnecting] = useState(false);
  const [first, setFirst] = useState<WhatsAppConnectionView | null>(null);
  const [done, setDone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const live = useWhatsAppConnection(connecting && !done, true, attempt);
  const view = live.data ?? first;
  const waiting = connecting && !done && view?.state !== "open";
  const connected = config?.configured || view?.state === "open";

  async function connect() {
    try {
      if (baseUrl || apiKey) await save();
      const { connection } = await start.mutateAsync();
      setFirst(connection);
      setAttempt((n) => n + 1);
      setDone(connection.state === "open");
      setConnecting(connection.state !== "open");
      if (connection.state === "open") toast.success("WhatsApp já conectado.");
    } catch (error) {
      toast.error(errorText(error, "Não foi possível iniciar a conexão."));
    }
  }

  async function unlink() {
    try {
      await disconnect.mutateAsync();
      setConnecting(false);
      setDone(false);
      setFirst(null);
      toast.success("WhatsApp desconectado.");
    } catch (error) {
      toast.error(errorText(error, "Não foi possível desconectar."));
    }
  }

  const justOpened = connecting && view?.state === "open";
  useEffect(() => {
    if (justOpened) toast.success("WhatsApp conectado.");
  }, [justOpened]);

  async function save() {
    try {
      await update.mutateAsync({
        ...(baseUrl ? { baseUrl } : {}),
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
        <p className="text-xs text-muted">Só URL e senha: a chave fica criptografada no servidor e nunca é exibida novamente. As cobranças usam o WhatsApp apenas como canal de envio.</p>
        <Field label="URL da Evolution API" hint={config?.baseUrl ? `Atual: ${config.baseUrl}` : undefined}>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={config?.baseUrl ?? "https://evolution.suaempresa.com"} />
        </Field>
        <Field label="Senha (API Key global)" hint={config?.hasApiKey ? "Já configurada — preencha apenas para substituir." : "A AUTHENTICATION_API_KEY da sua Evolution."}>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={config?.hasApiKey ? "••••••••" : ""} autoComplete="off" />
        </Field>
        <div className="rounded-md border border-border p-3 space-y-2">
          <p className="text-xs text-muted">
            {connected
              ? `Conectado${view?.number ? ` (+${view.number})` : ""} — instância ${config?.instance ?? view?.instance}.`
              : "A instância é criada na hora: clique em conectar e leia o QR Code em WhatsApp › Aparelhos conectados."}
          </p>
          {waiting && view ? (
            <div className="flex flex-col items-center gap-2">
              {view.qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={view.qr} alt="QR Code do WhatsApp" className="h-56 w-56 rounded bg-white p-2" />
              ) : (
                <p className="text-xs text-muted">Gerando QR Code…</p>
              )}
              {view.pairingCode ? <p className="text-xs">Ou digite o código: <b>{view.pairingCode}</b></p> : null}
              <p className="text-[11px] text-muted">O QR renova sozinho a cada poucos segundos.</p>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={connect} disabled={start.isPending || waiting}>
              {connected ? "Reconectar com QR Code" : "Conectar com QR Code"}
            </Button>
            {connected || waiting ? (
              <Button variant="secondary" size="sm" onClick={unlink} disabled={disconnect.isPending}>
                {waiting ? "Cancelar" : "Desconectar"}
              </Button>
            ) : null}
          </div>
        </div>
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
