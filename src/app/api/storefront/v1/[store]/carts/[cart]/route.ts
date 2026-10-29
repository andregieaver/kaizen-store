import { readApiCart } from "@/server/api-carts";
import { asStorefront, sfJson, sfOptions, sfProblem } from "@/server/storefront-route";

/** What a kept cart holds and costs now (D398): each line's live price, `available`, `fitted` and status, and a subtotal. */
export async function GET(request: Request, { params }: RouteContext<"/api/storefront/v1/[store]/carts/[cart]">) {
  const { store, cart } = await params;
  return asStorefront(request, store, async (caller) => {
    const found = await readApiCart(caller, cart);
    return found ? sfJson(found) : sfProblem(404, "no_such_cart", "No such cart, or it has gone to checkout or run out.");
  });
}

export const OPTIONS = sfOptions;
