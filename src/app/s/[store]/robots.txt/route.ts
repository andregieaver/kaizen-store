import { storeRobots } from "@/server/seo";
import { getOpenStore } from "@/server/stores";

/**
 * The store's robots.txt: the real one at `/robots.txt` on its own host (P7).
 * Until stores have hosts, crawlers read only the site's own /robots.txt,
 * which includes these rules, and this one is for the owner to check.
 */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/robots.txt">) {
  const store = await getOpenStore((await params).store);
  if (!store) return new Response("Not found", { status: 404 });
  return new Response(await storeRobots(store), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
