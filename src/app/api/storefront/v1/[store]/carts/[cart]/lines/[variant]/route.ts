import { cartQuantityBody } from "@/lib/storefront-api";
import { changeApiCart, readApiCart } from "@/server/api-carts";
import { asStorefront, sfOptions, sfProblem } from "@/server/storefront-route";

import { changed } from "../answer";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sets a line of a kept cart to exactly `{ quantity }` (D398); 0 removes it, and a quantity the variant's rule does not allow is refused. */
export async function PATCH(request: Request, { params }: RouteContext<"/api/storefront/v1/[store]/carts/[cart]/lines/[variant]">) {
  const { store, cart, variant } = await params;
  const body = cartQuantityBody.safeParse(await request.json().catch(() => null));
  return asStorefront(request, store, async (caller) => {
    if (!UUID.test(variant)) return sfProblem(400, "invalid_line", "The address names a variant by its id.");
    if (!body.success) return sfProblem(400, "invalid_line", "Send { quantity }.");
    return changed(await changeApiCart(caller, cart, { variantId: variant, quantity: body.data.quantity }, "set"), () => readApiCart(caller, cart));
  });
}

/** Removes a line of a kept cart (D398). */
export async function DELETE(request: Request, { params }: RouteContext<"/api/storefront/v1/[store]/carts/[cart]/lines/[variant]">) {
  const { store, cart, variant } = await params;
  return asStorefront(request, store, async (caller) => {
    if (!UUID.test(variant)) return sfProblem(400, "invalid_line", "The address names a variant by its id.");
    return changed(await changeApiCart(caller, cart, { variantId: variant, quantity: 0 }, "set"), () => readApiCart(caller, cart));
  });
}

export const OPTIONS = sfOptions;
