import { jsonLdText, type JsonLd } from "@/lib/seo";

/** Schema.org data for search engines and AI assistants. */
export function JsonLdScript({ data }: { data: JsonLd }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(data) }} />;
}
