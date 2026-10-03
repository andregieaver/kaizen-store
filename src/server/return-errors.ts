/**
 * What a rule of the withdrawal and returns database refused (D153), in words for the person who hit it. The rules in
 * `returns_rules` raise errors whose message starts with a code (`return_quantity: …`); Drizzle wraps the driver's
 * error, so the chain of causes is walked. A code that is not known is a bug and propagates (`guarded()`), never a
 * message made up.
 */

export const RETURN_ERROR_MESSAGES: Record<string, string> = {
  withdrawal_confirmed: "A confirmed withdrawal is a legal record and cannot be changed.",
  withdrawal_order_not_paid: "An order that was not paid cannot be withdrawn from.",
  withdrawal_starts_pending: "A withdrawal starts as a pending request and is confirmed in a second step.",
  withdrawal_fixed: "What was declared cannot be changed afterwards.",
  withdrawal_acknowledged: "An acknowledgement that was sent is not taken back.",
  withdrawal_lapsed: "The request was not confirmed in time. Start again.",
  withdrawal_no_lines: "A withdrawal names at least one line.",
  withdrawal_quantity: "More is declared than is left to withdraw from.",
  withdrawal_line_order: "A line belongs to another order.",
  return_kept: "A return is history and is never deleted. Cancel it instead.",
  return_order_not_paid: "An order that was not paid has nothing to return.",
  return_needs_confirmed_withdrawal: "A withdrawal return needs a confirmed withdrawal of the same order.",
  return_business_order: "A company has no statutory right of withdrawal, so its return is a voluntary one.",
  return_lifecycle: "That step is not allowed from where this return is.",
  return_withdrawal_not_cancellable: "A withdrawal is effective on the statement, so it is closed, not cancelled. If the goods never come back, close it without a refund.",
  return_refund_shipping: "The delivery of an order is refunded once, and never more than was paid for it.",
  return_withdrawal_not_declinable: "The right of withdrawal is not the store's to refuse. A line the law excludes is declined as a line.",
  return_decline_reason: "Say why the return is declined.",
  return_outcome: "A closed return is either refunded or closed with no refund.",
  return_times: "A step's time is set once and when the return reaches that step.",
  return_refund_recorded: "The refund of a return is recorded once.",
  return_refund_state: "A return is refunded after it is approved and before it is closed.",
  return_refund_over_paid: "The returns of an order cannot be refunded more than was paid.",
  return_refund_match: "The refund must be one of this order's, for the amount recorded.",
  return_fixed: "A return keeps its order, kind, request and number.",
  return_ended: "A return that has ended cannot be changed.",
  return_locked: "Lines are only added before the goods are on their way.",
  return_not_received: "The condition and any deduction are set when the goods have arrived.",
  return_line_order: "A line belongs to another order.",
  return_quantity: "More is returned than is left of that line.",
  return_not_declared: "A withdrawal return holds only what the withdrawal declared.",
  return_excluded: "The law excludes this line from the right of withdrawal, so it is declined.",
  return_decline_withdrawal: "A line with the right of withdrawal is not declined.",
  return_deduction: "A deduction is never more than the value of the goods.",
  copied_order: "This order is history copied from another store, so it is read-only.",
};

type Failure = { message?: unknown };

function chain(error: unknown): Failure[] {
  const found: Failure[] = [];
  for (let e = error, depth = 0; e && typeof e === "object" && depth < 6; e = (e as { cause?: unknown }).cause, depth++) {
    found.push(e as Failure);
  }
  return found;
}

const CODE = /\b((?:return|withdrawal)_[a-z_]+|copied_order):/;

/** The code a rule raised (`return_quantity`), or null when the error is not one of the returns rules. */
export function returnErrorCode(error: unknown): string | null {
  for (const failure of chain(error)) {
    if (typeof failure.message !== "string") continue;
    const match = CODE.exec(failure.message);
    if (match && match[1] in RETURN_ERROR_MESSAGES) return match[1];
  }
  return null;
}

/** The words for an error a returns rule raised, or null if it is not one. */
export function returnErrorMessage(error: unknown): string | null {
  const code = returnErrorCode(error);
  return code ? RETURN_ERROR_MESSAGES[code] : null;
}

export type Refused = { ok: false; code: string; problem: string };

/** Runs something that writes; a refusal by the database's rules becomes a plain result, anything else propagates. */
export async function guarded<T>(work: () => Promise<T>): Promise<T | Refused> {
  try {
    return await work();
  } catch (error) {
    const code = returnErrorCode(error);
    if (!code) throw error;
    return { ok: false, code, problem: RETURN_ERROR_MESSAGES[code] };
  }
}

/** A refusal made by the server's own check, in the same shape. */
export const refusal = (code: string, problem: string): Refused => ({ ok: false, code, problem });
