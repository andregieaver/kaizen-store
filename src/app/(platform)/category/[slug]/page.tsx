import type { Metadata } from "next";

import { termMetadata, termStaticParams, TermPages } from "../../term-listing";

type Props = PageProps<"/category/[slug]">;

/** Kaizen's pages in a category, with its subcategories (D50). */
export function generateStaticParams() {
  return termStaticParams("category");
}

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return termMetadata("category", params);
}

export default function Page({ params }: Props) {
  return <TermPages kind="category" params={params} />;
}
