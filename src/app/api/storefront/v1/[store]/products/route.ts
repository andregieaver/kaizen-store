import { productsQuery } from "@/lib/storefront-api";
import { storefrontProducts } from "@/server/storefront-api";
import { asStorefront, sfJson, sfOptions, sfProblem } from "@/server/storefront-route";

/** Products as the token's market lists them (D362): `?category=`, `?tag=`, `?sort=`, `?limit=` (at most 48). */
export async function GET(request: Request, { params }: RouteContext<"/api/storefront/v1/[store]/products">) {
  const { store } = await params;
  const query = productsQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return sfProblem(400, "invalid_request", "That request could not be read.");
  return asStorefront(request, store, async (caller) => {
    const view = await storefrontProducts(caller, query.data);
    return view ? sfJson(view, 200, true) : sfProblem(404, "no_such_market", "The token's market is no longer offered.");
  });
}

export const OPTIONS = sfOptions;
