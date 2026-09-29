/**
 * Minimal structured logger. Never pass tokens, password hashes, cookies, or
 * Authorization headers into `context` — this is the one place all server
 * logs funnel through, so a leak here is a leak everywhere.
 */
type LogContext = Record<string, unknown>;

const REDACTED_KEYS = new Set(["token", "password", "authorization", "cookie", "encryptedToken", "secret"]);

function redact(context: LogContext): LogContext {
  const output: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return output;
}

function emit(level: "info" | "warn" | "error", message: string, context?: LogContext) {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context ? redact(context) : {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};
