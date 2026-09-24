import { platformLlms } from "@/server/seo";

/** Kaizen for AI assistants (llmstxt.org), linking each store's own llms.txt. */
export async function GET() {
  return new Response(await platformLlms(), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
