import type { Metadata } from "next";

import { DocsHomeRoute, docsHomeMetadata } from "@/components/docs/docs-routes";

export function generateMetadata(): Metadata {
  return docsHomeMetadata("nb");
}

/** The docs' front page in Norwegian (D442). */
export default function NorwegianDocsHome() {
  return <DocsHomeRoute lang="nb" />;
}
