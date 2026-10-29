import { cartLineBody } from "@/lib/storefront-api";
import { changeApiCart, readApiCart } from "@/server/api-carts";
import { asStorefront, sfOptions } from "@/server/storefront-route";

import { changed } from "./answer";

/** Adds units of a variant to a kept cart (D398), put right by the variant's quantity rule and cut to what is available. */
export async function POST(request: Request, { params }: RouteContext<"/api/storefront/v1/[store]/carts/[cart]/lines">) {
  const { store, cart } = await params;
  const body = cartLineBody.safeParse(await request.json().catch(() => null));
  return asStorefront(request, store, async (caller) => {
    if (!body.success) return changed(null, null);
    return changed(await changeApiCart(caller, cart, body.data, "add"), () => readApiCart(caller, cart));
  });
}

export const OPTIONS = sfOptions;
