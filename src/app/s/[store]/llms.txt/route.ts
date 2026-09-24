import { storeLlms } from "@/server/seo";

/** The store for AI assistants (llmstxt.org): terms, markets and every product with its price. */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/llms.txt">) {
  const body = await storeLlms((await params).store);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
