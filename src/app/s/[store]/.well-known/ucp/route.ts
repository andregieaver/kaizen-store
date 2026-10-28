import { ucpProfile } from "@/lib/shopping-agents";
import { agentEndpoint, agentStore } from "@/server/shopping-agents";

/**
 * The store's UCP business profile (D353): the shopping service over MCP at its endpoint, with catalog search, lookup and cart. At
 * `/.well-known/ucp` on the store's own host (P7), and at `/s/{store}/.well-known/ucp` until then; a 404 while the store does not serve
 * shopping agents. No cookie, nothing of a person.
 */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/.well-known/ucp">) {
  const { store: slug } = await params;
  const store = await agentStore(slug);
  if (!store) return new Response("Not found", { status: 404 });
  return Response.json(ucpProfile(agentEndpoint(store.slug)), { headers: { "Cache-Control": "public, max-age=300" } });
}
