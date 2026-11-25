/**
 * The incident log (D895, `docs/audits/incident-autopilot-2026-11.md`): the words of its rows and the moves between its statuses, pure, so
 * the schema's checks, the database's trigger (`platform_incidents_move`), the server (`src/server/incidents.ts`) and the screens read one
 * list. A new status or move goes here first, then in the trigger of a new migration, then in `incidents.test.ts`.
 */

export const INCIDENT_KINDS = ["error", "warning", "enhancement"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

/** Where an entry came from. `nightly` and `platform_ai` propose enhancements; `owner` is an idea the owner wrote. */
export const INCIDENT_SOURCES = ["runtime", "cron", "watchdog", "status", "ci", "advisor", "nightly", "platform_ai", "owner"] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

export const INCIDENT_STATUSES = [
  "open",
  "proposed",
  "approved",
  "claimed",
  "fixed",
  "needs_owner",
  "done",
  "dismissed",
  "wont_fix",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Statuses only an enhancement has, and the one only an error or warning has: an enhancement is never `open` (its workable state is `approved`). */
export const ENHANCEMENT_ONLY: readonly IncidentStatus[] = ["proposed", "approved", "dismissed"];
export const PROBLEM_ONLY: readonly IncidentStatus[] = ["open"];

/** Statuses where nothing is waiting: a repeat of `dismissed` or `wont_fix` only counts, a repeat of `fixed` or `done` reopens (in `logIncident()`'s statement). */
export const CLOSED_STATUSES: readonly IncidentStatus[] = ["done", "dismissed", "wont_fix"];

/**
 * Every allowed move (`from` → `to`), the diagram of the plan's section 1 with the owner's Reopen: the trigger refuses any other. The kind
 * decides which of two moves applies where both exist (a claim that expires goes back to `open` for a problem, `approved` for an
 * enhancement), and the kind checks refuse the wrong one.
 */
export const INCIDENT_MOVES: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = {
  open: ["claimed", "wont_fix"],
  proposed: ["approved", "dismissed"],
  approved: ["claimed", "dismissed", "wont_fix"],
  claimed: ["open", "approved", "fixed", "needs_owner"],
  fixed: ["done", "open", "approved"],
  needs_owner: ["open", "approved", "wont_fix"],
  done: ["open"],
  dismissed: ["approved"],
  wont_fix: ["open", "approved"],
};

/** Whether `from` → `to` is a move the log allows for an entry of this kind. */
export function canMove(kind: IncidentKind, from: IncidentStatus, to: IncidentStatus): boolean {
  if (!INCIDENT_MOVES[from].includes(to)) return false;
  return statusFitsKind(kind, to);
}

export function statusFitsKind(kind: IncidentKind, status: IncidentStatus): boolean {
  return kind === "enhancement" ? !PROBLEM_ONLY.includes(status) : !ENHANCEMENT_ONLY.includes(status);
}

/** The workable status of a kind: where a reopened entry, or a claim given back, returns to. */
export function workableStatus(kind: IncidentKind): "open" | "approved" {
  return kind === "enhancement" ? "approved" : "open";
}

/** How a new entry starts: a problem `open`, a proposal `proposed`, the owner's own idea `approved` (the owner's answer, 20 November 2026). */
export function firstStatus(kind: IncidentKind, source: IncidentSource): IncidentStatus {
  if (kind !== "enhancement") return "open";
  return source === "owner" ? "approved" : "proposed";
}

/** The groups of the incidents page (the plan's section 4): what needs the owner, what is being worked, what was fixed lately. */
export function incidentGroup(status: IncidentStatus): "needs_you" | "waiting" | "being_fixed" | "fixed" | "closed" {
  if (status === "proposed" || status === "needs_owner") return "needs_you";
  if (status === "claimed") return "being_fixed";
  if (status === "fixed" || status === "done") return "fixed";
  if (status === "open" || status === "approved") return "waiting";
  return "closed";
}

/** The shortest gaps between woken runs the owner can choose, in hours (4 by default: the owner's answer, 20 November 2026). */
export const AUTOPILOT_GAPS = [1, 2, 4, 8, 12, 24] as const;
export const DEFAULT_AUTOPILOT_GAP = 4;

/** Why a run started (`platform_autopilot_runs.reason`). */
export const AUTOPILOT_REASONS = ["nightly", "work", "approve", "idea", "run_now", "manual"] as const;
export type AutopilotReason = (typeof AUTOPILOT_REASONS)[number];

/** How long a claim holds before another run may take the entry (the plan's section 5.2). */
export const CLAIM_HOURS = 3;
/** How long a fixed entry must stay quiet after its deploy before it is done. */
export const QUIET_HOURS = 24;
/** How long closed entries are kept, and so how long a dismissed proposal is remembered. */
export const INCIDENT_KEEP_DAYS = 180;
/** A repeat writes its count at most this often per fingerprint, so an error storm is one row and a few writes. */
export const REPEAT_WRITE_SECONDS = 60;

/** Length limits, checked in the database too. */
export const INCIDENT_LIMITS = { fingerprint: 200, title: 200, note: 2000, factsBytes: 8000 } as const;

/** A fingerprint: lower case, spaces folded, cut to the limit, so the same problem from two places meets one row. */
export function fingerprintOf(...parts: readonly (string | number | null | undefined)[]): string {
  return parts
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== "")
    .map((part) => String(part).trim().toLowerCase().replace(/\s+/g, " "))
    .join(":")
    .slice(0, INCIDENT_LIMITS.fingerprint);
}

/** A title kept to one line and the limit. */
export function cleanTitle(title: string): string {
  const line = title.replace(/\s+/g, " ").trim();
  return line.length > INCIDENT_LIMITS.title ? `${line.slice(0, INCIDENT_LIMITS.title - 1)}…` : line;
}

/** The hour, in Oslo, the daily summary email goes (the owner's answer, 20 November 2026). */
export const DIGEST_HOUR = 7;

/** The day whose summary is due at `now` (Oslo's date and hour), or null: from seven on, once a day, the day not yet sent. */
export function digestDue(lastDay: string | null, now: { date: string; hour: number }): string | null {
  if (now.hour < DIGEST_HOUR) return null;
  return lastDay === now.date ? null : now.date;
}
