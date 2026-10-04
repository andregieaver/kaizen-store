/**
 * Two-step sign-in for staff (wave 1, 1f, `docs/wave-1-trust.md` 2.6, 2.8, 4.5), the decisions as pure functions: whether
 * a session may use the admin, must be asked for its second step, or must set one up; the limit on wrong codes; the form
 * of a code. The server (`src/server/two-step.ts`) reads the facts, this file decides.
 *
 * The facts come from trusted places only: the signed `aal` claim of the verified token, and for a session at `aal1`
 * one server-side `getUser()` whose `factors` list is the server's. The session cookie's own copy of the user is the
 * person's to edit and is never read for this. `accounts.two_step_since` is a mirror for display and decides nothing.
 */

/** What the gate knows about a session; `enrolled` is null when it could not be found out (Supabase Auth unreachable). */
export type AssuranceInput = {
  /** The `aal` claim: `aal2` means a conventional sign-in plus a second factor. */
  level: "aal1" | "aal2";
  /** Whether the account has a verified factor, from the server; ignored at `aal2`, which proves it. */
  enrolled: boolean | null;
  platformAdmin: boolean;
  /** The store being entered requires two-step of its members (`stores.require_two_step`); false where no store is in hand. */
  storeRequires: boolean;
  /** `accounts.two_step_reenrol_at` is set: a recovery code was used or a platform admin reset the second step. */
  reenrolPending: boolean;
  /** `ADMIN_TWO_STEP=off`: the break-glass that lifts the whole requirement. */
  killSwitch: boolean;
};

export type EnrolReason = "platform" | "store" | "reset";

/**
 * - `ok`: the admin may be used.
 * - `challenge`: a factor exists and this session has not passed it.
 * - `enrol`: no factor, and one is required; the reason says why, for the page.
 * - `off`: the kill switch is on; the admin may be used and the next sign-in audit-logs it.
 * - `unknown`: an `aal1` session whose enrolment could not be read; held, never let through.
 */
export type Assurance = { state: "ok" } | { state: "challenge" } | { state: "enrol"; reason: EnrolReason } | { state: "off" } | { state: "unknown" };

/** Whether a state lets the person into the admin. */
export const mayUseAdmin = (assurance: Assurance): boolean => assurance.state === "ok" || assurance.state === "off";

export function assuranceOf(input: AssuranceInput): Assurance {
  if (input.killSwitch) return { state: "off" };
  if (input.level === "aal2") return { state: "ok" };
  if (input.enrolled === null) return { state: "unknown" };
  if (input.enrolled) return { state: "challenge" };
  // No factor at aal1: held only where something requires one. A reset by a recovery code or a platform admin comes first,
  // because it asks for a new factor whatever else is true.
  if (input.reenrolPending) return { state: "enrol", reason: "reset" };
  if (input.platformAdmin) return { state: "enrol", reason: "platform" };
  if (input.storeRequires) return { state: "enrol", reason: "store" };
  return { state: "ok" };
}

/** Why a person is held at enrolment, in a sentence for the page. */
export function enrolReasonText(reason: EnrolReason, storeName?: string | null): string {
  if (reason === "platform") return "Platform admins must use two-step sign-in.";
  if (reason === "store") return `${storeName?.trim() || "This store"} requires two-step sign-in.`;
  return "Your two-step sign-in was reset, so you need to set it up again.";
}

// ---------------------------------------------------------------------------
// The limit on wrong codes
// ---------------------------------------------------------------------------

/** Five failed second-step attempts by one account in 15 minutes pause attempts for that account for 15 minutes. */
export const TWO_STEP_LIMIT = { attempts: 5, windowMinutes: 15 } as const;
const WINDOW_MS = TWO_STEP_LIMIT.windowMinutes * 60 * 1000;

export type AttemptState = { locked: false; remaining: number } | { locked: true; until: Date; minutes: number };

/**
 * Where an account stands, from the times of its attempts that were not shown to be right (the `account.two_step_attempt`
 * entries of the audit log, so no table of its own, written BEFORE a code is checked and counted until it passes, so parallel
 * guesses cannot all pass the check; see `reserveAttempt()`): the attempts in the last 15 minutes are counted, and at five the
 * account is paused until 15 minutes after the fifth. An attempt refused while paused writes nothing, so it does not extend the pause.
 */
export function attemptState(failures: readonly Date[], now: Date): AttemptState {
  const recent = failures.filter((t) => now.getTime() - t.getTime() < WINDOW_MS && t.getTime() <= now.getTime()).sort((a, b) => a.getTime() - b.getTime());
  if (recent.length < TWO_STEP_LIMIT.attempts) return { locked: false, remaining: TWO_STEP_LIMIT.attempts - recent.length };
  const fifth = recent[TWO_STEP_LIMIT.attempts - 1];
  const until = new Date(fifth.getTime() + WINDOW_MS);
  if (until.getTime() <= now.getTime()) return { locked: false, remaining: TWO_STEP_LIMIT.attempts };
  return { locked: true, until, minutes: Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60000)) };
}

/** The refusal's words while paused. */
export const lockedText = (minutes: number): string => `Too many attempts. Wait ${minutes <= 1 ? "a minute" : `${minutes} minutes`}.`;

// ---------------------------------------------------------------------------
// What is typed
// ---------------------------------------------------------------------------

/** The six digits of an authenticator app, spaces taken out; null when it is not six digits. */
export function normaliseTotp(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

// ---------------------------------------------------------------------------
// Where the pages are
// ---------------------------------------------------------------------------

/** The two-step pages live under the sign-in, outside the gated area so there is no loop (a new `/admin/{word}` would take a store's address). */
export const TWO_STEP_PATHS = {
  challenge: "/admin/sign-in/two-step",
  enrol: "/admin/sign-in/two-step/set-up",
  recovery: "/admin/sign-in/two-step/recovery",
} as const;

/** The page a held state is sent to, with where to go after (`next`, which the page checks again with `safeNext()`); null when nothing holds the person. */
export function heldPath(assurance: Assurance, next?: string | null): string | null {
  const suffix = next ? `?next=${encodeURIComponent(next)}` : "";
  if (assurance.state === "challenge") return `${TWO_STEP_PATHS.challenge}${suffix}`;
  if (assurance.state === "enrol") return `${TWO_STEP_PATHS.enrol}${suffix}`;
  return null;
}

/** `ADMIN_TWO_STEP`: only the exact word `off` (in any case, trimmed) lifts the requirement; anything else, or nothing, leaves it on. */
export const twoStepKillSwitch = (value: string | undefined | null): boolean => value?.trim().toLowerCase() === "off";

/** The audit action written when the kill switch is seen at a sign-in. */
export const KILL_SWITCH_ACTION = "account.two_step_switch_off";
