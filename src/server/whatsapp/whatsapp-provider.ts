import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getConfigs } from "@/server/integrations/config";

/** Erro de envio — `retryable` separa falha transitória (rede/5xx/429) de rejeição definitiva (número inválido, 4xx). */
export class WhatsAppSendError extends AppError {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message, 502, "WHATSAPP_SEND_FAILED");
    this.retryable = retryable;
  }
}

export class WhatsAppNotConfiguredError extends AppError {
  constructor() {
    super("O WhatsApp ainda não foi configurado (Configurações → Integrações → WhatsApp).", 409, "WHATSAPP_NOT_CONFIGURED");
  }
}

export interface WhatsAppSendResult {
  providerMessageId?: string;
}

export interface WhatsAppStatus {
  connected: boolean;
  detail?: string;
}

/**
 * Canal de mensagens. Cobrança depende desta interface, nunca de um provider
 * concreto — trocar Evolution por outro serviço = nova classe + um `case` na fábrica.
 */
export interface WhatsAppProvider {
  readonly name: string;
  /** `phone` já normalizado (somente dígitos, formato internacional). */
  sendText(phone: string, text: string): Promise<WhatsAppSendResult>;
  getStatus(): Promise<WhatsAppStatus>;
}

const REQUEST_TIMEOUT_MS = 20_000;

export class EvolutionApiProvider implements WhatsAppProvider {
  readonly name = "Evolution API";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly instance: string,
  ) {}

  private url(path: string): string {
    return new URL(path.replace(/^\/+/, ""), `${this.baseUrl.replace(/\/+$/, "")}/`).toString();
  }

  async sendText(phone: string, text: string): Promise<WhatsAppSendResult> {
    let response: Response;
    try {
      response = await fetch(this.url(`message/sendText/${encodeURIComponent(this.instance)}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: this.apiKey },
        body: JSON.stringify({ number: phone, text }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      logger.warn("whatsapp_request_failed", { message: error instanceof Error ? error.message : String(error) });
      throw new WhatsAppSendError("Não foi possível falar com o serviço de WhatsApp.", true);
    }

    if (!response.ok) {
      // Nunca repassa o corpo cru do provider ao usuário (pode ter detalhes internos).
      logger.warn("whatsapp_request_rejected", { status: response.status });
      const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
      throw new WhatsAppSendError(`O serviço de WhatsApp recusou o envio (HTTP ${response.status}).`, retryable);
    }

    const body = (await response.json().catch(() => ({}))) as { key?: { id?: string }; id?: string };
    return { providerMessageId: body.key?.id ?? body.id };
  }

  async getStatus(): Promise<WhatsAppStatus> {
    try {
      const response = await fetch(this.url(`instance/connectionState/${encodeURIComponent(this.instance)}`), {
        headers: { apikey: this.apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!response.ok) return { connected: false, detail: `HTTP ${response.status}` };
      const body = (await response.json()) as { instance?: { state?: string }; state?: string };
      const state = body.instance?.state ?? body.state ?? "unknown";
      return { connected: state === "open", detail: state };
    } catch {
      return { connected: false, detail: "Serviço inacessível" };
    }
  }
}

export interface WhatsAppConfigSummary {
  configured: boolean;
  provider: string;
  baseUrl: string | null;
  instance: string | null;
  hasApiKey: boolean;
}

export async function getWhatsAppProvider(): Promise<WhatsAppProvider> {
  const cfg = await getConfigs(["whatsapp.provider", "whatsapp.baseUrl", "whatsapp.apiKey", "whatsapp.instance"]);
  if (!cfg["whatsapp.baseUrl"] || !cfg["whatsapp.apiKey"] || !cfg["whatsapp.instance"]) throw new WhatsAppNotConfiguredError();
  switch (cfg["whatsapp.provider"] ?? "EVOLUTION") {
    case "EVOLUTION":
      return new EvolutionApiProvider(cfg["whatsapp.baseUrl"], cfg["whatsapp.apiKey"], cfg["whatsapp.instance"]);
    default:
      throw new WhatsAppNotConfiguredError();
  }
}

export async function getWhatsAppConfigSummary(): Promise<WhatsAppConfigSummary> {
  const cfg = await getConfigs(["whatsapp.provider", "whatsapp.baseUrl", "whatsapp.apiKey", "whatsapp.instance"]);
  return {
    configured: Boolean(cfg["whatsapp.baseUrl"] && cfg["whatsapp.apiKey"] && cfg["whatsapp.instance"]),
    provider: cfg["whatsapp.provider"] ?? "EVOLUTION",
    baseUrl: cfg["whatsapp.baseUrl"] ?? null,
    instance: cfg["whatsapp.instance"] ?? null,
    hasApiKey: Boolean(cfg["whatsapp.apiKey"]),
  };
}
