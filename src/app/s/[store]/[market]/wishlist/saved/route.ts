import { resolveShop } from "@/server/shop";
import { savedProductIds } from "@/server/wishlists";

/**
 * The products this shopper has saved (D34), for the hearts on product
 * cards and pages, which are the same for everyone until this arrives; so
 * the pages stay cached and fast.
 */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/[market]/wishlist/saved">) {
  const { store, market } = await params;
  const shop = await resolveShop(store, market);
  const products = shop ? await savedProductIds(shop.store.id) : [];
  return Response.json({ products }, { headers: { "Cache-Control": "private, no-store" } });
}
