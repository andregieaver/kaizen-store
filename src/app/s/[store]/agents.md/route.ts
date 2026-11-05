import { storeFileUrl } from "@/lib/paths";
import { agentEndpoint, agentProfileUrl, agentsMarkdown } from "@/lib/shopping-agents";
import { agentProblem } from "@/server/shopping-agents";
import { getOpenStore } from "@/server/stores";

/** The store's `agents.md` (D353): what an AI agent may do here, and where; says so when the store does not serve shopping agents. */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/agents.md">) {
  const store = await getOpenStore((await params).store);
  if (!store || store.isTemplate || store.starter || store.sandbox || store.privateMode) return new Response("Not found", { status: 404 });
  const serves = agentProblem(store) === null;
  const body = agentsMarkdown({
    name: store.name,
    // The store's own address and files: on its host, or under `/s/{store}` on Kaizena Flow's, never Kaizena Flow's own root.
    site: storeFileUrl(store.slug, ""),
    endpoint: serves ? agentEndpoint(store.slug) : null,
    profile: serves ? agentProfileUrl(store.slug) : null,
    llms: storeFileUrl(store.slug, "/llms.txt"),
  });
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
