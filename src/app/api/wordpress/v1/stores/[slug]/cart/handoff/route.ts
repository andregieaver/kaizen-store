import { handoffBody, toLines } from "@/lib/wordpress-cart";
import { takeHandoff } from "@/server/wordpress";
import { handoffCart } from "@/server/wordpress-shop";
import { asPluginForStore, json, problem } from "@/server/wordpress-route";

/**
 * Makes the cart in the store (D170) and gives the one-time address that opens it for the shopper: `{ market, lines, to: "cart" | "checkout" }`.
 * The store checks every line as if the shopper had added it there, and cuts a quantity to the stock.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/wordpress/v1/stores/[slug]/cart/handoff">) {
  const { slug } = await params;
  let raw: unknown = null;
  try {
    const text = await request.text();
    raw = text.length > 6_000 ? null : JSON.parse(text);
  } catch {
    raw = null;
  }
  const body = handoffBody.safeParse(raw);
  if (!body.success) return problem(400, "invalid_cart", "That cart could not be read.");
  return asPluginForStore(request, slug, async (caller, store) => {
    if (!(await takeHandoff(caller.connectionId))) return problem(429, "rate_limited", "Too many carts from this connection. Try again in a few minutes.");
    const made = await handoffCart(store, body.data.market || null, toLines(body.data.lines), body.data.to);
    if (made.ok) return json({ url: made.url, lines: made.lines });
    return made.reason === "no_such_market" ? problem(404, "no_such_market", "No such market in that store.") : problem(422, "nothing_to_buy", "None of those products can be bought now.");
  });
}
