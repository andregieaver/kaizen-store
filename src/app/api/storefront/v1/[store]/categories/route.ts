import { storefrontCategories } from "@/server/storefront-api";
import { asStorefront, sfJson, sfOptions } from "@/server/storefront-route";

/** The store's product categories (with their depth) and tags (D362). */
export async function GET(request: Request, { params }: RouteContext<"/api/storefront/v1/[store]/categories">) {
  const { store } = await params;
  return asStorefront(request, store, async (caller) => sfJson(await storefrontCategories(caller), 200, true));
}

export const OPTIONS = sfOptions;
