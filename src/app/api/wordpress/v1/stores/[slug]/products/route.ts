import { pickProducts } from "@/server/wordpress";
import { asPluginForStore, json } from "@/server/wordpress-route";

/** Products to pick by hand: `?q=` finds them by name, `?limit=` up to 50. Titles and a small picture only. */
export async function GET(request: Request, { params }: RouteContext<"/api/wordpress/v1/stores/[slug]/products">) {
  const { slug } = await params;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 30);
  return asPluginForStore(request, slug, async (_caller, store) =>
    json({ products: await pickProducts(store, url.searchParams.get("q") ?? "", Number.isFinite(limit) ? limit : 30) }),
  );
}
