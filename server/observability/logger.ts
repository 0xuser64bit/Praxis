/**
 * Structured logging + error reporting. Emits one JSON object per line so the
 * platform (Vercel, Datadog, etc.) ingests fields, not free text. `reportError`
 * is the single seam for error tracking: it logs structured `error` events today
 * and is where a Sentry/observability sink would attach without touching call
 * sites. Money/bigints serialize as strings so a value never becomes a float.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const configured = process.env.PRAXIS_LOG_LEVEL?.trim().toLowerCase() as LogLevel | undefined;
  if (configured && configured in LEVEL_RANK) return LEVEL_RANK[configured];
  return process.env.NODE_ENV === "production" ? LEVEL_RANK.info : LEVEL_RANK.debug;
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

function emit(level: LogLevel, message: string, fields?: LogFields) {
  if (LEVEL_RANK[level] < minLevel()) return;
  const entry = { level, msg: message, time: new Date().toISOString(), ...fields };
  const line = JSON.stringify(entry, replacer);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit("debug", message, fields),
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
};

/** Normalize any thrown value into structured, loggable fields. */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  }
  return { errorMessage: String(error) };
}

/**
 * Report an unexpected error. The single integration point for an external error
 * tracker; for now it emits a structured `error` log the platform can alert on.
 */
export function reportError(error: unknown, context?: LogFields) {
  logger.error("praxis.error", { ...context, ...errorFields(error) });
}
