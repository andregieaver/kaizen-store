import type { Metadata } from "next";

import { DocsRoot, docsRootMetadata } from "@/components/docs/docs-root";

import "../globals.css";

export function generateMetadata(): Promise<Metadata> {
  return docsRootMetadata("en");
}

/** The docs portal in English (D442): `/docs/…` on Kaizena Flow's site, the root of the docs' own host. */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <DocsRoot lang="en">{children}</DocsRoot>;
}
