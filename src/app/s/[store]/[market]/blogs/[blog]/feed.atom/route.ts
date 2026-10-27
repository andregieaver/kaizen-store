import { blogFeed } from "@/server/blogs";

/** Another blog's Atom feed (D341) at `/blogs/{handle}/feed.atom`: its published articles, newest first, cached with the store's pages. */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/[market]/blogs/[blog]/feed.atom">) {
  const { store, market, blog } = await params;
  const body = await blogFeed(store, market, blog);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "Content-Type": "application/atom+xml; charset=utf-8" } });
}
