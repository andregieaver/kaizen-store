import type { Metadata } from "next";

import { DocsRoot, docsRootMetadata } from "@/components/docs/docs-root";

import "../globals.css";

export function generateMetadata(): Promise<Metadata> {
  return docsRootMetadata("nb");
}

/**
 * The docs portal in Norwegian (D442, D312's `/no/`): the store owners' track at `/no/docs/…` on Kaizena Flow's site, `/no/…` on the docs'
 * own host. A root of its own, so the page is `<html lang="nb">`; the developers' track is in English alone.
 */
export default function NorwegianDocsLayout({ children }: { children: React.ReactNode }) {
  return <DocsRoot lang="nb">{children}</DocsRoot>;
}
