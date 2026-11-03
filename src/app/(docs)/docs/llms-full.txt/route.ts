import { platformText } from "@/lib/platform-text";
import { docsLlmsFull } from "@/lib/docs-text";
import { docsIndex } from "@/server/docs";

/** Every docs page in full as plain Markdown, in one file for AI tools (D442): English first, then Norwegian. */
export function GET() {
  const words = platformText("en").docs;
  return new Response(docsLlmsFull(docsIndex(), { title: words.title, description: words.description, changelog: words.changelog }), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
