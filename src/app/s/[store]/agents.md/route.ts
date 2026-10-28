import { storeSiteUrl } from "@/lib/paths";
import { agentsMarkdown } from "@/lib/shopping-agents";
import { agentEndpoint, agentProblem, agentProfileUrl } from "@/server/shopping-agents";
import { getOpenStore } from "@/server/stores";

/** The store's `agents.md` (D353): what an AI agent may do here, and where; says so when the store does not serve shopping agents. */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/agents.md">) {
  const store = await getOpenStore((await params).store);
  if (!store || store.isTemplate || store.starter || store.privateMode) return new Response("Not found", { status: 404 });
  const serves = agentProblem(store) === null;
  const site = storeSiteUrl(store.slug);
  const body = agentsMarkdown({
    name: store.name,
    site,
    endpoint: serves ? agentEndpoint(store.slug) : null,
    profile: serves ? agentProfileUrl(store.slug) : null,
    llms: `${site}/llms.txt`,
  });
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
