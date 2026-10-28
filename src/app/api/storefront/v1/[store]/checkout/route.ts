import { cartBody } from "@/lib/storefront-api";
import { storefrontCheckout } from "@/server/storefront-api";
import { asStorefront, sfJson, sfOptions, sfProblem } from "@/server/storefront-route";

/** Makes the cart in the store with its own checks and answers the one-time address of its checkout (D362); nothing is ordered here. */
export async function POST(request: Request, { params }: RouteContext<"/api/storefront/v1/[store]/checkout">) {
  const { store } = await params;
  const body = cartBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return sfProblem(400, "invalid_cart", "Send { lines: [{ variantId, quantity }] }.");
  return asStorefront(request, store, async (caller) => {
    const made = await storefrontCheckout(caller, body.data);
    if (!made.ok) return sfProblem(made.reason === "no_such_market" ? 404 : 422, made.reason, made.reason === "no_such_market" ? "The token's market is no longer offered." : "Nothing asked for can be bought now.");
    return sfJson({ url: made.url, lines: made.lines });
  });
}

export const OPTIONS = sfOptions;
