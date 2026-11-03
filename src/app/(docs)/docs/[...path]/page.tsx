import type { Metadata } from "next";

import { DocsPageRoute, docsPageMetadata, docsStaticParams } from "@/components/docs/docs-routes";

type Props = PageProps<"/docs/[...path]">;

/** Every track, section and page of the docs in English, and the changelog, prerendered (D442). */
export function generateStaticParams() {
  return docsStaticParams("en");
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return docsPageMetadata("en", (await params).path);
}

/** A docs address in English: a track, a section, an article or the changelog. */
export default async function DocsPage({ params }: Props) {
  return <DocsPageRoute lang="en" segments={(await params).path} />;
}
