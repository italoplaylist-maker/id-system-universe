/**
 * Erros nos logs dos sistemas — lógica PURA (sem banco, sem rede): o que é uma linha de erro, como agrupar erros
 * iguais e como não contar duas vezes a mesma linha em leituras seguidas. Tudo por regra de texto: não gasta token.
 */

export const ERROR_PATTERN =
  /\b(\w*error|\w*exception|erro|panic|fatal|fail(ed|ure)?|falha|unhandled|traceback|segfault|out of memory|oom|econnrefused|etimedout|enotfound|econnreset)s?\b/i;
export const WARN_PATTERN = /\b(warn(ing)?|deprecat\w*|aviso)\b/i;

/** "0 errors", "errors: 0", "failed=0", "sem erros": a palavra aparece, mas não é erro. */
const NOISE_PATTERN = /\b(0|no|sem|nenhum|zero)\s+(errors?|erros?|failures?|falhas?|failed)\b|\b(errors?|erros?|fail(ed|ures?)?|falhas?)\s*[=:]\s*(0|false|none|nenhum)\b|\bno errors?\b/i;

export type LogLevel = "INFO" | "WARN" | "ERROR";

export function isErrorLine(line: string): boolean {
  return ERROR_PATTERN.test(line) && !NOISE_PATTERN.test(line);
}

export function classifyLogLine(line: string): LogLevel {
  if (isErrorLine(line)) return "ERROR";
  if (WARN_PATTERN.test(line)) return "WARN";
  return "INFO";
}

/** Hash curto e estável (dois FNV-1a de 32 bits = 16 hex): suficiente para agrupar, não é criptografia. */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** Texto da linha sem o que muda a cada ocorrência (hora, números, ids, IPs): linhas do mesmo erro ficam iguais. */
export function normalizeForFingerprint(line: string): string {
  return line
    .replace(/\x1b\[[0-9;]*m/g, "")
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}(\.\d+)?z?/g, "")
    .replace(/\b\d{2}:\d{2}:\d{2}(\.\d+)?\b/g, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<id>")
    .replace(/\b0x[0-9a-f]+\b/g, "<hex>")
    .replace(/\b[0-9a-f]{16,}\b/g, "<hex>")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, "<ip>")
    .replace(/\d+/g, "#")
    .replace(/(["'`])[^"'`]{0,60}\1/g, '"…"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export const fingerprintOf = (line: string): string => hashText(normalizeForFingerprint(line));
/** Identidade EXATA da linha (com hora): serve para não contar de novo o que já foi visto na leitura anterior. */
export const lineIdentity = (line: string): string => hashText(line.trim());

/** Continuação de um erro: stack trace indentado, "at ...", "Caused by ...". */
const CONTINUATION = /^(\s+\S|\s*at\s|caused by\b|\s*\.\.\. \d+ more)/i;

export interface ErrorEvent {
  /** A linha do erro. */
  line: string;
  /** Linhas seguintes que fazem parte do mesmo erro (stack trace), no máximo `maxContext`. */
  context: string[];
  fingerprint: string;
  identity: string;
}

export function extractErrorEvents(lines: string[], maxContext = 6): ErrorEvent[] {
  const out: ErrorEvent[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!isErrorLine(line)) continue;
    const context: string[] = [];
    while (context.length < maxContext && i + 1 < lines.length && CONTINUATION.test(lines[i + 1]) && !isErrorLine(lines[i + 1])) {
      context.push(lines[i + 1]);
      i += 1;
    }
    out.push({ line, context, fingerprint: fingerprintOf(line), identity: lineIdentity(line) });
  }
  return out;
}

/** Só as ocorrências que não apareciam na leitura anterior (mesma linha exata = já contada). */
export function onlyNew(events: ErrorEvent[], previous: ReadonlySet<string>): ErrorEvent[] {
  return events.filter((e) => !previous.has(e.identity));
}

export interface ErrorGroupHit {
  fingerprint: string;
  count: number;
  /** A última ocorrência, com o stack trace: o que o agente lê para investigar. */
  sample: string;
}

export const MAX_SAMPLE_CHARS = 1200;

export function groupEvents(events: ErrorEvent[]): ErrorGroupHit[] {
  const groups = new Map<string, ErrorGroupHit>();
  for (const e of events) {
    const sample = [e.line, ...e.context].join("\n").slice(0, MAX_SAMPLE_CHARS);
    const g = groups.get(e.fingerprint);
    if (g) {
      g.count += 1;
      g.sample = sample;
    } else groups.set(e.fingerprint, { fingerprint: e.fingerprint, count: 1, sample });
  }
  return [...groups.values()];
}
