import type { Metadata } from "next";

import { termMetadata, termStaticParams, TermPages } from "../../../term-listing";

type Props = PageProps<"/blog/tag/[slug]">;

/** Kaizen's articles with a tag (D57). */
export function generateStaticParams() {
  return termStaticParams("tag", "article");
}

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return termMetadata("tag", params, "article");
}

export default function Page({ params }: Props) {
  return <TermPages kind="tag" params={params} type="article" />;
}
