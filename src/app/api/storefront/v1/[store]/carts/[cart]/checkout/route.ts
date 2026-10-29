import { apiCartCheckout } from "@/server/api-carts";
import { asStorefront, sfJson, sfOptions, sfProblem } from "@/server/storefront-route";

/**
 * Hands a kept cart to the store's checkout (D398): answers a one-time address (fifteen minutes) that makes it the shopper's cart there.
 * The key opens nothing after this; nothing is ordered or paid here.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/storefront/v1/[store]/carts/[cart]/checkout">) {
  const { store, cart } = await params;
  return asStorefront(request, store, async (caller) => {
    const made = await apiCartCheckout(caller, cart);
    if (!made.ok) return made.reason === "not_found" ? sfProblem(404, "no_such_cart", "No such cart, or it has gone to checkout or run out.") : sfProblem(422, "nothing_to_buy", "The cart is empty.");
    return sfJson({ url: made.url });
  });
}

export const OPTIONS = sfOptions;
