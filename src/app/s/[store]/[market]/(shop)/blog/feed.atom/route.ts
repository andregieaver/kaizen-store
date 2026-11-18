import { blogFeed } from "@/server/blogs";

/**
 * The first blog's Atom feed (D341) at `/blog/feed.atom`: its published articles, newest first. Cached with the store's pages, so
 * publishing (by hand or by a schedule) refreshes it; a scheduled article is in it only once it is published.
 */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/[market]/blog/feed.atom">) {
  const { store, market } = await params;
  const body = await blogFeed(store, market, null);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "Content-Type": "application/atom+xml; charset=utf-8" } });
}
