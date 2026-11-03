import type { Metadata } from "next";

import { DocsSearchRoute, docsSearchMetadata } from "@/components/docs/docs-search-page";

/**
 * Drawn at each request with its search done before the first byte (no static shell and no streamed part), so it works without
 * JavaScript: a streamed part needs a script to be shown.
 */
export const instant = false;

export function generateMetadata(): Metadata {
  return docsSearchMetadata("en");
}

/** The docs' search in English (D443): `/docs/search?q=…`, `/search` on the docs' host. */
export default async function DocsSearchPage({ searchParams }: PageProps<"/docs/search">) {
  return <DocsSearchRoute lang="en" query={await searchParams} />;
}
