/**
 * Where a sign-in ends (wave 1, 1f, `docs/wave-1-trust.md` 2.8): a person with a verified second factor goes to the page that asks
 * for it, with where they were going kept in `next`; everyone else goes on. The redirect is for the person's benefit only: the gate
 * (`getAccount()`) holds an enrolled `aal1` session whether or not a sign-in route sent it here, so a link that skips this changes
 * nothing. The user object here is the one the Auth server just answered with, not the session cookie's.
 */
import { safeNext } from "./password";
import { TWO_STEP_PATHS } from "./two-step";

type WithFactors = { factors?: readonly { status?: string | null }[] | null } | null | undefined;

/** Whether the account has a verified factor, from what the Auth server answered. */
export const hasVerifiedFactor = (user: WithFactors): boolean => (user?.factors ?? []).some((factor) => factor.status === "verified");

/** The address a finished first step leads to: the second step's page when one is due, else `next` (held to the admin by `safeNext()`). */
export function afterFirstStep(user: WithFactors, next: string | null | undefined, fallback = "/admin"): string {
  const target = safeNext(next, fallback);
  return hasVerifiedFactor(user) ? `${TWO_STEP_PATHS.challenge}?next=${encodeURIComponent(target)}` : target;
}
