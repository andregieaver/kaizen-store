import { termsOf } from "@/server/wordpress";
import { asPluginForStore, json } from "@/server/wordpress-route";

/** A store's product categories (with their depth) and tags, to choose a view's source from. */
export async function GET(request: Request, { params }: RouteContext<"/api/wordpress/v1/stores/[slug]/terms">) {
  const { slug } = await params;
  return asPluginForStore(request, slug, async (_caller, store) => json(await termsOf(store)));
}
