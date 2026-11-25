import { z } from "zod";

import { INCIDENT_LIMITS } from "./incidents";

/**
 * The incident log's part of Kaizena Flow's own API (D895), pure: the routes under `/api/platform/v1/incidents` and the bodies they take.
 * Only a token with the `incidents` scope reaches them; they are the autopilot's Claude Code session's only way to the log (never SQL). The
 * statuses still move only as `INCIDENT_MOVES` allows, in the server and in the database's trigger.
 */

export type IncidentApiRoute =
  | { method: "GET"; name: "board" }
  | { method: "GET"; name: "due" }
  | { method: "GET"; name: "entry"; id: string }
  | { method: "POST"; name: "ingest" }
  | { method: "POST"; name: "propose" }
  | { method: "POST"; name: "run_start" }
  | { method: "POST"; name: "run_finish"; id: string }
  | { method: "POST"; name: "claim" | "fixed" | "needs_owner" | "note" | "give_back"; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = { claim: "claim", fixed: "fixed", "needs-owner": "needs_owner", note: "note", "give-back": "give_back" } as const;

/** The route a request asks for, from its method and the path after `/api/platform/v1/incidents`; null for none. */
export function incidentRouteOf(method: string, path: readonly string[]): IncidentApiRoute | null {
  const [first, second, third, ...rest] = path;
  if (rest.length > 0) return null;
  if (method === "GET") {
    if (second !== undefined) return null;
    if (first === undefined) return { method, name: "board" };
    if (first === "due") return { method, name: "due" };
    return UUID.test(first) ? { method, name: "entry", id: first.toLowerCase() } : null;
  }
  if (method !== "POST" || first === undefined) return null;
  if (first === "runs") {
    if (second === undefined) return { method, name: "run_start" };
    return third === "finish" && UUID.test(second) ? { method, name: "run_finish", id: second.toLowerCase() } : null;
  }
  if (third !== undefined) return null;
  if (second === undefined) return first === "ingest" ? { method, name: "ingest" } : first === "propose" ? { method, name: "propose" } : null;
  return UUID.test(first) && Object.hasOwn(ACTIONS, second) ? { method, name: ACTIONS[second as keyof typeof ACTIONS], id: first.toLowerCase() } : null;
}

/** A Claude Code session's link, as the session names itself: only a claude.ai address. */
const SESSION_LINK = /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]{8,64}$/;

const session = z.string().trim().regex(SESSION_LINK, "session is the session's own claude.ai/code/session_… link");
const note = z.string().trim().min(1).max(INCIDENT_LIMITS.note);
const fact = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
const facts = z.record(z.string().max(60), fact).refine((f) => Object.keys(f).length <= 30, "at most 30 facts");

/** What the session may put in the log itself: what it pulled from Vercel, the advisors and the `ci-red` issue. */
export const ingestBody = z.object({
  entries: z
    .array(
      z.object({
        kind: z.enum(["error", "warning"]),
        source: z.enum(["runtime", "ci", "advisor"]),
        fingerprint: z.string().trim().min(3).max(INCIDENT_LIMITS.fingerprint),
        title: z.string().trim().min(1).max(INCIDENT_LIMITS.title),
        facts: facts.optional(),
      }),
    )
    .min(1)
    .max(50),
});

/** A proposal of the nightly run: a title, its reason in a sentence and the evidence behind it; it waits for the owner's Approve. */
export const proposeBody = z.object({
  session,
  fingerprint: z.string().trim().min(3).max(INCIDENT_LIMITS.fingerprint),
  title: z.string().trim().min(1).max(INCIDENT_LIMITS.title),
  reason: z.string().trim().min(10).max(500),
  evidence: facts.optional(),
});

export const claimBody = z.object({ session, hours: z.number().int().min(1).max(12).optional() });
export const fixedBody = z.object({ session, commit: z.string().trim().regex(/^[0-9a-f]{7,40}$/i, "commit is the fix's sha"), note });
export const noteBody = z.object({ session, note });
export const runStartBody = z.object({ session, reason: z.enum(["nightly", "work", "approve", "idea", "run_now", "manual"]), wake: z.string().regex(UUID).optional() });
export const runFinishBody = z.object({
  summary: z.string().trim().min(1).max(INCIDENT_LIMITS.note),
  claimed: z.number().int().min(0).max(20),
  fixed: z.number().int().min(0).max(20),
  proposed: z.number().int().min(0).max(20),
});

/** The limits of section 6 of the plan: entries a session holds at once, and proposals a night. */
export const MAX_CLAIMS_PER_SESSION = 3;
export const MAX_PROPOSALS_PER_NIGHT = 3;

/** A zod problem as one line for the caller: the field and what is wrong. */
export function problemOf(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "The body is not valid.";
}
