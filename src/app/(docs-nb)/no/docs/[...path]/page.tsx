import type { Metadata } from "next";

import { DocsPageRoute, docsPageMetadata, docsStaticParams } from "@/components/docs/docs-routes";

type Props = PageProps<"/no/docs/[...path]">;

/** The store owners' track in Norwegian, prerendered (D442); a page without its Norwegian twin is a 404 here. */
export function generateStaticParams() {
  return docsStaticParams("nb");
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return docsPageMetadata("nb", (await params).path);
}

/** A docs address in Norwegian: the owners' track, a section or an article. */
export default async function NorwegianDocsPage({ params }: Props) {
  return <DocsPageRoute lang="nb" segments={(await params).path} />;
}
