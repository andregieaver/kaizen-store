import { isHandle } from "@/lib/storefront-api";
import { storefrontProduct } from "@/server/storefront-api";
import { asStorefront, sfJson, sfOptions, sfProblem } from "@/server/storefront-route";

/** A product's page as the token's market shows it (D362): pictures, options, variants with their prices and stock, and its words. */
export async function GET(request: Request, { params }: RouteContext<"/api/storefront/v1/[store]/products/[handle]">) {
  const { store, handle } = await params;
  if (!isHandle(handle)) return sfProblem(404, "no_such_product", "No such product.");
  return asStorefront(request, store, async (caller) => {
    const page = await storefrontProduct(caller, handle);
    return page ? sfJson(page, 200, true) : sfProblem(404, "no_such_product", "No such product.");
  });
}

export const OPTIONS = sfOptions;
