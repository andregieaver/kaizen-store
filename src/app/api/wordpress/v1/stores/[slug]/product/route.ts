import { productPageOf } from "@/server/wordpress-shop";
import { asPluginForStore, json, problem } from "@/server/wordpress-route";

/** A product with its pictures, options, variants (each priced and with its stock) and the words of its page: `?handle=` and `?market=`. */
export async function GET(request: Request, { params }: RouteContext<"/api/wordpress/v1/stores/[slug]/product">) {
  const { slug } = await params;
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle") ?? "";
  const market = url.searchParams.get("market") ?? "";
  if (!/^[a-z0-9-]*$/i.test(market) || market.length > 40) return problem(400, "invalid_request", "That request could not be read.");
  return asPluginForStore(request, slug, async (_caller, store) => {
    const page = await productPageOf(store, market || null, handle);
    return page ? json(page) : problem(404, "no_such_product", "No such product.");
  });
}
