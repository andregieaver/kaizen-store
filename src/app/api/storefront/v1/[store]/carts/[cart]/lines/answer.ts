import type { ApiCartChange } from "@/server/api-carts";
import { sfJson, sfProblem } from "@/server/storefront-route";

const WORDS: Record<Exclude<ApiCartChange, { ok: true }>["reason"], [number, string]> = {
  not_found: [404, "No such cart, or it has gone to checkout or run out."],
  unavailable: [422, "That variant cannot be bought in this market now."],
  quantity: [422, "The variant's quantity rule does not allow that quantity: see the line's quantity_rule."],
  too_many_lines: [422, "A cart holds at most 50 lines."],
};

/** How a change of a kept cart answers (D398): the cart as it is now, or why nothing changed. */
export async function changed(outcome: ApiCartChange | null, read: (() => Promise<unknown>) | null): Promise<Response> {
  if (!outcome) return sfProblem(400, "invalid_line", "Send { variantId, quantity }.");
  if (!outcome.ok) {
    const [status, message] = WORDS[outcome.reason];
    return sfProblem(status, outcome.reason, message);
  }
  const cart = read ? await read() : null;
  return cart ? sfJson(cart) : sfProblem(404, "not_found", WORDS.not_found[1]);
}
