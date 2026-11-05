/** Modelos que o Claude oferece AGORA para a conta logada neste servidor (resposta real do Claude Code, não uma lista fixa). */
export interface AvailableModel {
  value: string;
  displayName: string;
  description: string | null;
  resolvedModel: string | null;
  efforts: string[];
}

let cache: { at: number; models: AvailableModel[] } | null = null;
let inflight: Promise<AvailableModel[]> | null = null;
const TTL_MS = 60_000;

async function fetchModels(): Promise<AvailableModel[]> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  // Entrada em streaming que nunca envia mensagem: só abre o processo para perguntar os modelos e fecha.
  async function* silence(): AsyncGenerator<never> {
    await new Promise(() => undefined);
  }
  const q = query({ prompt: silence(), options: { cwd: process.env.HOME || "/", settingSources: [] } });
  try {
    const list = await Promise.race([q.supportedModels(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("O Claude não respondeu a tempo.")), 25_000))]);
    return list.map((m) => ({
      value: m.value,
      displayName: m.displayName,
      description: m.description ?? null,
      resolvedModel: m.resolvedModel ?? null,
      efforts: m.supportedEffortLevels ?? [],
    }));
  } finally {
    q.close();
  }
}

export async function listAvailableModels(force = false): Promise<AvailableModel[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.models;
  inflight ??= fetchModels()
    .then((models) => {
      cache = { at: Date.now(), models };
      return models;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Depois de entrar/sair da conta a lista muda. */
export function forgetModels() {
  cache = null;
}
