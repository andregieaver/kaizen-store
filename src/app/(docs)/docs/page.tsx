import type { Metadata } from "next";

import { DocsHomeRoute, docsHomeMetadata } from "@/components/docs/docs-routes";

export function generateMetadata(): Metadata {
  return docsHomeMetadata("en");
}

/** The docs' front page in English (D442): the store owners' track and the developers'. */
export default function DocsHome() {
  return <DocsHomeRoute lang="en" />;
}
