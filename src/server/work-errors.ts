import { z } from "zod";

import { fillWords } from "@/lib/admin-fill";
import { workEn } from "@/lib/admin-messages/work.en";

/**
 * What went wrong in Work, in words for the person using the admin (English here, the
 * `work` catalogue's `errors`; actions show them in the account's language with `workProblemText()`,
 * D312 A10, docs/work.md 4.8). Shared by every Work server
 * module (`work.ts`, `work-time.ts`, `work-invoices.ts`, …) and their actions.
 *
 * The database's rules raise errors whose message starts with a
 * `work_<thing>.<reason>` code (docs/work.md 4.2a), so what a trigger or a
 * function refused can be told apart from a bug: `workErrorCode()` finds the
 * code in the error (Drizzle wraps the driver's error, so the chain of causes
 * is walked), `workErrorMessage()` words it, and `workProblems()` also knows
 * the few constraints a person can run into (a second draft for an
 * assignment, a row of another store). Anything it does not recognise is not
 * a problem to show but a bug: `workGuard()` lets that propagate.
 */

/** What every Work server function and action returns: the extra fields of a success, or the problems to show. */
export type WorkResult<T extends object = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

/** The messages of a failed check, once each, in order (what forms show under the fields). */
export function zodProblems(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => issue.message))];
}

/** A failed result in one line. */
export const problem = (...problems: string[]): { ok: false; problems: string[] } => ({ ok: false, problems });

/**
 * Codes the database raises, with what to tell the person. Codes with a
 * detail after them (`not_ready`, `date_before_previous`) are worded by
 * `workErrorMessage()`, which adds the detail.
 */
export const WORK_ERROR_MESSAGES: Record<string, string> = workEn.errors.messages;

/** What a readiness code from `commerce.work_invoice_problems()` means for the owner, and where to fix it. */
export const READINESS_MESSAGES: Record<string, string> = workEn.errors.readiness;

export const readinessMessage = (code: string): string =>
  READINESS_MESSAGES[code.trim()] ?? fillWords(workEn.errors.notReady, { what: code.trim().replace(/_/g, " ") });

type Failure = { code?: unknown; constraint?: unknown; message?: unknown };

/** The error and what caused it, deepest last (Drizzle wraps the driver's error). */
function chain(error: unknown): Failure[] {
  const found: Failure[] = [];
  for (
    let e = error, depth = 0;
    e && typeof e === "object" && depth < 6;
    e = (e as { cause?: unknown }).cause, depth++
  ) {
    found.push(e as Failure);
  }
  return found;
}

const WORK_CODE = /\b(work_[a-z]+(?:_[a-z]+)?\.[a-z_]+)\b(?::\s*([^\n]*))?/;

/** The `work_*.reason` code a database rule raised, and the detail after it, or null if the error is not one. */
export function workErrorParts(error: unknown): { code: string; detail: string } | null {
  for (const failure of chain(error)) {
    if (typeof failure.message !== "string") continue;
    const match = WORK_CODE.exec(failure.message);
    if (
      match &&
      (match[1] in WORK_ERROR_MESSAGES || /^work_(?:invoice|credit_note|payment|series|time)\./.test(match[1]))
    )
      return { code: match[1], detail: (match[2] ?? "").trim() };
  }
  return null;
}

/** Just the code, e.g. `work_time.immutable`. */
export const workErrorCode = (error: unknown): string | null => workErrorParts(error)?.code ?? null;

/**
 * The person-friendly message for an error a Work rule raised, or null if it
 * is not one. `not_ready` lists what is missing; a backdated date names the
 * previous document's date.
 */
export function workErrorMessage(error: unknown): string | null {
  const parts = workErrorParts(error);
  if (!parts) return null;
  const known = WORK_ERROR_MESSAGES[parts.code];
  if (parts.code === "work_invoice.not_ready") {
    const codes = parts.detail
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    return codes.length > 0 ? `${known} ${codes.map(readinessMessage).join(" ")}` : known;
  }
  if (parts.code.endsWith(".date_before_previous")) {
    const date = /\d{4}-\d{2}-\d{2}/.exec(parts.detail)?.[0];
    return date ? `${known} ${fillWords(workEn.errors.datedAt, { date })}` : known;
  }
  return known ?? (parts.detail || fillWords(workEn.errors.notAllowed, { code: parts.code }));
}

/** The codes of a `work_invoice.not_ready` error, for the readiness panel; empty when it is another error. */
export function notReadyCodes(error: unknown): string[] {
  const parts = workErrorParts(error);
  if (parts?.code !== "work_invoice.not_ready") return [];
  return parts.detail
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Constraints a person can run into, by name (docs/work.md 4.2, 4.2a). */
const CONSTRAINT_MESSAGES: Record<string, string> = workEn.errors.constraints;

/**
 * What to show for an error from Work's database code: a rule's message, a
 * named constraint, a row that is not in this store (the composite foreign
 * keys refuse it), or a clash of two writers. Null for anything else, which
 * is a bug and must not be shown as if it were the person's mistake.
 */
export function workProblems(error: unknown): string[] | null {
  const message = workErrorMessage(error);
  if (message) return [message];
  for (const failure of chain(error)) {
    const constraint = typeof failure.constraint === "string" ? failure.constraint : null;
    if (constraint && CONSTRAINT_MESSAGES[constraint]) return [CONSTRAINT_MESSAGES[constraint]];
    if (failure.code === "23503") {
      return typeof failure.message === "string" && /update or delete on table/.test(failure.message)
        ? [workEn.errors.dependents]
        : [workEn.errors.gone];
    }
    if (failure.code === "40001" || failure.code === "40P01")
      return [workEn.errors.sameTime];
  }
  return null;
}

/** Runs a write, turning what the database's rules refuse into a failed result and letting anything else propagate. */
export async function workGuard<T extends { ok: boolean }>(
  run: () => Promise<T>,
): Promise<T | { ok: false; problems: string[] }> {
  try {
    return await run();
  } catch (error) {
    const problems = workProblems(error);
    if (problems) return { ok: false, problems };
    throw error;
  }
}
