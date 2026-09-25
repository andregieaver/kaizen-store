import type { Metadata } from "next";

import { termMetadata, termStaticParams, TermPages } from "../../../term-listing";

type Props = PageProps<"/blog/category/[slug]">;

/** Kaizen's articles in a category, with its subcategories (D57). */
export function generateStaticParams() {
  return termStaticParams("category", "article");
}

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return termMetadata("category", params, "article");
}

export default function Page({ params }: Props) {
  return <TermPages kind="category" params={params} type="article" />;
}
