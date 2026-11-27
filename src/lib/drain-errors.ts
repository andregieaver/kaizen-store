/**
 * Runtime errors from Vercel's log drain into the incident log (D895 IA-17): the drain that already carries production's logs for usage
 * (`usage-drain.ts`, D314) is read once more for its error lines, so an error reaches the log within a minute instead of at the
 * autopilot's next run. Pure: each error line is reduced to its route's shape, its event or error name and a message cut short with every
 * email, long number and id masked; lines are grouped by the fingerprint the runbook uses (`runtime:{route}:{event or error name}`), so a
 * storm is one entry with a count. The incident log's own lines are left out, so it never feeds itself. Never an IP address, user agent,
 * query, referrer or a person's data.
 */

import { cleanTitle, fingerprintOf } from "./incidents";

export type DrainError = {
  fingerprint: string;
  /** `warning` for a line Node itself wrote about the process (`(node:8) [DEP0169] DeprecationWarning: …`), `error` for everything else. */
  kind: "error" | "warning";
  title: string;
  route: string;
  name: string;
  message: string;
  count: number;
  deployment: string | null;
};

/** At most this many entries from one batch; the rest wait for the next error of their kind. */
export const MAX_DRAIN_ERRORS = 20;
const MESSAGE_MAX = 300;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Events of the incident log and its jobs: never logged as incidents, or a failure to log one would log another. */
const OWN_EVENTS = /^(incidents?|autopilot|drain|admin_heat|admin_recordings)\./;

/**
 * Node's own process warnings, written to stderr and so at Vercel's level error: `(node:8) [DEP0169] DeprecationWarning: …`. They come from a
 * library (web-push's `url.parse()`, incident 1af5e1d0) and nothing failed, so they are warnings named by their code, not errors.
 */
const NODE_WARNING = /^\(node:\d+\) (?:\[([A-Z]+\d+)\] )?([A-Za-z]*Warning):/;

/** A path's shape: no query, a store's slug and every id, number or hash replaced, so one route is one entry and names no store. */
export function routeOf(path: string): string {
  const clean = path.split(/[?#]/)[0] || "/";
  const parts = clean.split("/").map((part, i, all) => {
    if (part === "") return part;
    if ((all[i - 1] === "s" && i === 2) || (all[i - 1] === "admin" && i === 2 && !["platform", "account", "stores", "legal", "hosting", "sign-in"].includes(part))) return ":store";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(part) || /\d{3,}/.test(part) || /^[A-Za-z0-9_-]{24,}$/.test(part)) return ":id";
    return part.length > 40 ? ":id" : part;
  });
  return parts.join("/").slice(0, 120) || "/";
}

/** A message with every email, long number and id masked, on one line, cut short. */
export function maskMessage(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\d{5,}/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MESSAGE_MAX);
}

/** Our own structured line (`log()`), when the message is one. */
function structured(message: string): Record<string, unknown> | null {
  if (!message.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(message);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The error lines of a drain batch, grouped. A line counts when it is production's, from a function (`lambda` or `edge`), and at level
 * error (Vercel's level, or our own line's). Its name is our line's `event` (with its error's name), else the first word of the message
 * (`TypeError`, `Error`).
 */
export function drainErrors(objects: readonly Record<string, unknown>[]): DrainError[] {
  const groups = new Map<string, DrainError>();
  for (const o of objects) {
    if (o.environment !== undefined && o.environment !== "production") continue;
    if (o.source !== "lambda" && o.source !== "edge") continue;
    const raw = typeof o.message === "string" ? o.message : "";
    const line = structured(raw);
    const level = line?.level ?? o.level;
    if (level !== "error") continue;
    const event = typeof line?.event === "string" ? line.event : null;
    if (event && OWN_EVENTS.test(event)) continue;
    const warning = line ? null : NODE_WARNING.exec(raw);
    const errorName = typeof line?.errorName === "string" ? line.errorName : (/^([A-Z][A-Za-z]*Error|Error)\b/.exec(raw)?.[1] ?? null);
    const name = (warning ? (warning[1] ?? warning[2]) : (event ?? errorName ?? "error")).slice(0, 80);
    const proxy = isRecord(o.proxy) ? o.proxy : {};
    const path = typeof o.path === "string" ? o.path : typeof proxy.path === "string" ? proxy.path : "";
    const route = routeOf(path);
    const message = maskMessage(typeof line?.errorMessage === "string" ? `${errorName ?? ""} ${line.errorMessage}` : raw);
    const fingerprint = fingerprintOf("runtime", route, name);
    const seen = groups.get(fingerprint);
    if (seen) {
      seen.count += 1;
      continue;
    }
    if (groups.size >= MAX_DRAIN_ERRORS) continue;
    groups.set(fingerprint, {
      fingerprint,
      kind: warning ? "warning" : "error",
      title: cleanTitle(`Runtime ${warning ? "warning" : "error"}: ${name} on ${route}`),
      route,
      name,
      message,
      count: 1,
      deployment: typeof o.deploymentId === "string" ? o.deploymentId.slice(0, 60) : null,
    });
  }
  return [...groups.values()];
}
