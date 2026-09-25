import { storeRobots } from "@/server/seo";
import { getOpenStore } from "@/server/stores";

/**
 * The store's robots.txt. Crawlers read only the site's own /robots.txt,
 * which includes these rules; this one is for the owner to check, and
 * becomes the store's real one once stores have their own addresses (P2).
 */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/robots.txt">) {
  const store = await getOpenStore((await params).store);
  if (!store) return new Response("Not found", { status: 404 });
  return new Response(await storeRobots(store), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
