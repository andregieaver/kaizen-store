import { newCartBody } from "@/lib/storefront-api";
import { makeApiCart, readApiCart } from "@/server/api-carts";
import { asStorefront, sfJson, sfOptions, sfProblem } from "@/server/storefront-route";

/**
 * Makes a cart the store keeps (D398): `{ lines? }`, each line put in with the store's own checks. Answers the cart as `GET /carts/{cart}`
 * does, with its key (`cart`), a secret only the caller holds.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/storefront/v1/[store]/carts">) {
  const { store } = await params;
  const body = newCartBody.safeParse((await request.json().catch(() => null)) ?? {});
  if (!body.success) return sfProblem(400, "invalid_cart", "Send { lines?: [{ variantId, quantity }] }.");
  return asStorefront(request, store, async (caller) => {
    const made = await makeApiCart(caller, body.data.lines);
    if (!made) return sfProblem(404, "no_such_market", "The token's market is no longer offered.");
    const cart = await readApiCart(caller, made.key);
    return cart ? sfJson(cart, 201) : sfProblem(404, "no_such_market", "The token's market is no longer offered.");
  });
}

export const OPTIONS = sfOptions;
