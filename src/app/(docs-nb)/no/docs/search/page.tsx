import type { Metadata } from "next";

import { DocsSearchRoute, docsSearchMetadata } from "@/components/docs/docs-search-page";

/**
 * Drawn at each request with its search done before the first byte (no static shell and no streamed part), so it works without
 * JavaScript: a streamed part needs a script to be shown.
 */
export const instant = false;

export function generateMetadata(): Metadata {
  return docsSearchMetadata("nb");
}

/** The docs' search in Norwegian (D443): `/no/docs/search?q=…`, `/no/search` on the docs' host. */
export default async function NorwegianDocsSearchPage({ searchParams }: PageProps<"/no/docs/search">) {
  return <DocsSearchRoute lang="nb" query={await searchParams} />;
}
