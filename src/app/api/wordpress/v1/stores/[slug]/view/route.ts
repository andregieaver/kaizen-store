import { viewQuery } from "@/lib/wordpress";
import { viewOf } from "@/server/wordpress";
import { asPluginForStore, json, problem } from "@/server/wordpress-route";

/**
 * The products a saved view shows (`?source=all|category|tag|products`, `categories`, `tags`, `ids`, `sort`, `limit`, `market`), priced and
 * worded in the market as the storefront does. What the plugin draws; it works out no price of its own.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/wordpress/v1/stores/[slug]/view">) {
  const { slug } = await params;
  const query = viewQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return problem(400, "invalid_view", "That view could not be read.");
  return asPluginForStore(request, slug, async (_caller, store) => {
    const view = await viewOf(store, query.data);
    return view ? json(view) : problem(404, "no_such_market", "No such market in that store.");
  });
}
