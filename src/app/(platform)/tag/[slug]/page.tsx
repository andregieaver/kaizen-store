import type { Metadata } from "next";

import { termMetadata, termStaticParams, TermPages } from "../../term-listing";

type Props = PageProps<"/tag/[slug]">;

/** Kaizen's pages with a tag (D50). */
export function generateStaticParams() {
  return termStaticParams("tag");
}

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return termMetadata("tag", params);
}

export default function Page({ params }: Props) {
  return <TermPages kind="tag" params={params} />;
}
