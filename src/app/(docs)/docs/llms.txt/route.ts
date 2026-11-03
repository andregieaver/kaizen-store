import { platformText } from "@/lib/platform-text";
import { docsLlms } from "@/lib/docs-text";
import { docsIndex } from "@/server/docs";

/** The docs for AI assistants (llmstxt.org, D442): each page's Markdown address and summary, by track and section, then the generated reference's. */
export function GET() {
  const words = platformText("en").docs;
  const body = docsLlms(docsIndex(), {
    title: words.title,
    description: words.description,
    tracks: { owners: words.tracks.owners.name, developers: words.tracks.developers.name },
    changelog: words.changelog,
    reference: words.apiReference,
  });
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
