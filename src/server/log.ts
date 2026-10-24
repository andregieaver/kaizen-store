import "server-only";

/**
 * Structured logs (PSI 2026-10-24, REL-02): one JSON object per line, so Vercel's log search and a drain can filter by `event`,
 * `level`, `job` or `storeId` instead of reading prose. New server code logs through `log()`; the older `console.error` lines move
 * over as they are touched. Never put a person's name, email, address or a secret in `fields`: ids and counts only.
 */

export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

/** What an error says about itself, short enough for one line: its name, message, Next's digest and the first lines of its stack. */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    const digest = "digest" in error && typeof error.digest === "string" ? error.digest : undefined;
    // A wrapped error (a database driver's "Failed query", a fetch's) keeps the reason in its cause.
    const cause = error.cause instanceof Error ? error.cause.message : error.cause === undefined ? undefined : String(error.cause);
    return {
      errorName: error.name,
      errorMessage: error.message.slice(0, 500),
      errorCause: cause?.slice(0, 500),
      errorDigest: digest,
      errorStack: error.stack?.split("\n").slice(1, 6).map((line) => line.trim()).join(" | ").slice(0, 800),
    };
  }
  return { errorMessage: String(error).slice(0, 500) };
}

/** The line as written: level, event and time first, then the fields, then the error's; undefined fields left out. */
export function logLine(level: LogLevel, event: string, fields: LogFields = {}, error?: unknown): string {
  const entry: LogFields = { level, event, at: new Date().toISOString(), ...fields, ...(error === undefined ? {} : errorFields(error)) };
  return JSON.stringify(Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined)));
}

/** Writes one structured line: `log("error", "cron.job_failed", { job }, error)`. */
export function log(level: LogLevel, event: string, fields: LogFields = {}, error?: unknown): void {
  const line = logLine(level, event, fields, error);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
