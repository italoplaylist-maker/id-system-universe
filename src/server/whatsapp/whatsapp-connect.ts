import { randomBytes } from "node:crypto";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { getConfigs, setConfig } from "@/server/integrations/config";

/**
 * Conexão do WhatsApp por QR Code: o usuário só cadastra a URL e a senha (chave global) da Evolution API.
 * A INSTÂNCIA é criada aqui, na hora, com nome gerado; o QR é lido no celular e, quando a Evolution confirma
 * ("open"), a instância passa a ser a usada pelo Universe. Todas as chamadas partem do servidor: a chave nunca vai ao navegador.
 */

const TIMEOUT_MS = 20_000;

export type ConnectState = "none" | "qr" | "connecting" | "open" | "error";

export interface WhatsAppConnectView {
  state: ConnectState;
  /** Imagem do QR (data URL), quando há um para ler. */
  qr?: string;
  /** Código de pareamento (alternativa ao QR: digitar no celular). */
  pairingCode?: string;
  instance?: string;
  /** Número conectado (quando a Evolution informa). */
  number?: string | null;
  detail?: string;
}

interface Cfg {
  baseUrl: string;
  apiKey: string;
  instance: string | null;
  pending: string | null;
}

async function loadCfg(): Promise<Cfg> {
  const c = await getConfigs(["whatsapp.baseUrl", "whatsapp.apiKey", "whatsapp.instance", "whatsapp.pendingInstance"]);
  if (!c["whatsapp.baseUrl"] || !c["whatsapp.apiKey"]) throw new ValidationError("Informe a URL e a senha da Evolution API e salve antes de conectar.");
  return { baseUrl: c["whatsapp.baseUrl"], apiKey: c["whatsapp.apiKey"], instance: c["whatsapp.instance"] ?? null, pending: c["whatsapp.pendingInstance"] ?? null };
}

async function evo<T>(cfg: Cfg, method: string, path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
  const url = new URL(path.replace(/^\/+/, ""), `${cfg.baseUrl.replace(/\/+$/, "")}/`).toString();
  try {
    const res = await fetch(url, {
      method,
      headers: { apikey: cfg.apiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { status: res.status, data };
  } catch (error) {
    logger.warn("whatsapp_connect_unreachable", { message: error instanceof Error ? error.message : String(error) });
    throw new ValidationError("Não consegui falar com a Evolution API. Confira a URL e se o serviço está no ar.");
  }
}

interface QrBody {
  base64?: string;
  code?: string;
  pairingCode?: string | null;
  qrcode?: { base64?: string; code?: string; pairingCode?: string | null };
}

const toDataUrl = (b64?: string) => (b64 ? (b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`) : undefined);

function qrFrom(body: QrBody | null): Pick<WhatsAppConnectView, "qr" | "pairingCode"> {
  const q = body?.qrcode ?? body;
  return { qr: toDataUrl(q?.base64), pairingCode: q?.pairingCode ?? undefined };
}

async function stateOf(cfg: Cfg, name: string): Promise<{ state: string; missing: boolean }> {
  const r = await evo<{ instance?: { state?: string }; state?: string }>(cfg, "GET", `instance/connectionState/${encodeURIComponent(name)}`);
  if (r.status === 404) return { state: "close", missing: true };
  if (r.status === 401 || r.status === 403) throw new ValidationError("A Evolution API recusou a senha (chave). Confira a senha global (AUTHENTICATION_API_KEY).");
  return { state: r.data?.instance?.state ?? r.data?.state ?? "unknown", missing: false };
}

async function numberOf(cfg: Cfg, name: string): Promise<string | null> {
  const r = await evo<Array<{ ownerJid?: string; number?: string; owner?: string }>>(cfg, "GET", `instance/fetchInstances?instanceName=${encodeURIComponent(name)}`).catch(() => null);
  const row = Array.isArray(r?.data) ? r!.data[0] : null;
  const raw = row?.number ?? row?.ownerJid ?? row?.owner ?? null;
  return raw ? raw.split("@")[0].replace(/\D/g, "") || null : null;
}

async function fetchQr(cfg: Cfg, name: string): Promise<{ view: Pick<WhatsAppConnectView, "qr" | "pairingCode">; missing: boolean }> {
  const r = await evo<QrBody>(cfg, "GET", `instance/connect/${encodeURIComponent(name)}`);
  return { view: qrFrom(r.data), missing: r.status === 404 };
}

async function createInstance(cfg: Cfg): Promise<{ name: string; view: Pick<WhatsAppConnectView, "qr" | "pairingCode"> }> {
  const name = `universe-${randomBytes(4).toString("hex")}`;
  const r = await evo<QrBody & { message?: unknown }>(cfg, "POST", "instance/create", { instanceName: name, qrcode: true, integration: "WHATSAPP-BAILEYS" });
  if (r.status === 401 || r.status === 403) throw new ValidationError("A Evolution API recusou a senha (chave). Use a senha GLOBAL (AUTHENTICATION_API_KEY), não a de uma instância.");
  if (r.status >= 400) throw new ValidationError(`A Evolution API não criou a instância (HTTP ${r.status}).`);
  await setConfig("whatsapp.pendingInstance", name);
  let view = qrFrom(r.data);
  if (!view.qr) view = (await fetchQr(cfg, name)).view; // algumas versões só devolvem o QR em /instance/connect
  return { name, view };
}

/** Passo 1: prepara a conexão. Se já está conectado, só informa; senão cria a instância (se preciso) e devolve o QR. */
export async function startWhatsAppConnection(): Promise<WhatsAppConnectView> {
  const cfg = await loadCfg();
  // Já há instância ativa: se está conectada, nada a fazer; se caiu, pede um QR novo para ELA.
  if (cfg.instance) {
    const s = await stateOf(cfg, cfg.instance);
    if (s.state === "open") return { state: "open", instance: cfg.instance, number: await numberOf(cfg, cfg.instance) };
    if (!s.missing) {
      const q = await fetchQr(cfg, cfg.instance);
      return { state: q.view.qr || q.view.pairingCode ? "qr" : "connecting", instance: cfg.instance, ...q.view };
    }
  }
  // Instância pendente de uma tentativa anterior: reaproveita se ainda existe.
  if (cfg.pending) {
    const q = await fetchQr(cfg, cfg.pending);
    if (!q.missing) return { state: q.view.qr || q.view.pairingCode ? "qr" : "connecting", instance: cfg.pending, ...q.view };
    await setConfig("whatsapp.pendingInstance", "");
  }
  const created = await createInstance(cfg);
  return { state: created.view.qr || created.view.pairingCode ? "qr" : "connecting", instance: created.name, ...created.view };
}

/**
 * Passo 2 (a tela chama a cada poucos segundos): consulta o estado. `refreshQr` busca um QR novo (o QR expira em ~30 s).
 * Quando a Evolution diz "open", a instância vira a oficial do Universe.
 */
export async function pollWhatsAppConnection(opts: { refreshQr?: boolean; actor?: { userId: string; ip?: string; userAgent?: string } } = {}): Promise<WhatsAppConnectView> {
  const cfg = await loadCfg();
  const name = cfg.pending ?? cfg.instance;
  if (!name) return { state: "none" };
  const s = await stateOf(cfg, name);
  if (s.missing) {
    if (cfg.pending) await setConfig("whatsapp.pendingInstance", "");
    return { state: "none", detail: "A instância não existe mais na Evolution API. Conecte de novo." };
  }
  if (s.state === "open") {
    if (cfg.pending) {
      await setConfig("whatsapp.instance", cfg.pending);
      await setConfig("whatsapp.pendingInstance", "");
      // A instância antiga (se havia outra) é desligada: um só número por Universe.
      if (cfg.instance && cfg.instance !== cfg.pending) {
        await evo(cfg, "DELETE", `instance/logout/${encodeURIComponent(cfg.instance)}`).catch(() => undefined);
        await evo(cfg, "DELETE", `instance/delete/${encodeURIComponent(cfg.instance)}`).catch(() => undefined);
      }
      await recordAuditEvent({ userId: opts.actor?.userId, action: "WHATSAPP_CONFIG_UPDATED", status: "SUCCESS", entityType: "WhatsApp", metadata: { connected: true, instance: cfg.pending }, ipAddress: opts.actor?.ip, userAgent: opts.actor?.userAgent });
    }
    return { state: "open", instance: cfg.pending ?? cfg.instance ?? name, number: await numberOf(cfg, name) };
  }
  const view: WhatsAppConnectView = { state: s.state === "connecting" ? "connecting" : "qr", instance: name };
  if (opts.refreshQr) {
    const q = await fetchQr(cfg, name);
    Object.assign(view, q.view);
    view.state = q.view.qr || q.view.pairingCode ? "qr" : "connecting";
  }
  return view;
}

/** Desconecta o número e apaga a instância (a URL e a senha ficam). */
export async function disconnectWhatsApp(actor: { userId: string; ip?: string; userAgent?: string }): Promise<void> {
  const cfg = await loadCfg();
  for (const name of [cfg.instance, cfg.pending]) {
    if (!name) continue;
    await evo(cfg, "DELETE", `instance/logout/${encodeURIComponent(name)}`).catch(() => undefined);
    await evo(cfg, "DELETE", `instance/delete/${encodeURIComponent(name)}`).catch(() => undefined);
  }
  await setConfig("whatsapp.instance", "");
  await setConfig("whatsapp.pendingInstance", "");
  await recordAuditEvent({ userId: actor.userId, action: "WHATSAPP_CONFIG_UPDATED", status: "SUCCESS", entityType: "WhatsApp", metadata: { disconnected: true }, ipAddress: actor.ip, userAgent: actor.userAgent });
}
