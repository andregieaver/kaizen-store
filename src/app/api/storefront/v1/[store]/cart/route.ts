import { cartBody } from "@/lib/storefront-api";
import { storefrontCart } from "@/server/storefront-api";
import { asStorefront, sfJson, sfOptions, sfProblem } from "@/server/storefront-route";

/**
 * What a cart the site keeps costs now (D362): `{ lines: [{ variantId, quantity }] }`, each line with its live price, stock and the quantity
 * the store's own rules allow, and a subtotal (shipping and discounts are worked out at checkout).
 */
export async function POST(request: Request, { params }: RouteContext<"/api/storefront/v1/[store]/cart">) {
  const { store } = await params;
  const body = cartBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return sfProblem(400, "invalid_cart", "Send { lines: [{ variantId, quantity }] }.");
  return asStorefront(request, store, async (caller) => {
    const quote = await storefrontCart(caller, body.data);
    return quote ? sfJson(quote) : sfProblem(404, "no_such_market", "The token's market is no longer offered.");
  });
}

export const OPTIONS = sfOptions;
