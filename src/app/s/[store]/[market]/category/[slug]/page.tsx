import type { Metadata } from "next";

import { termMetadata, termStaticParams, TermProducts } from "../../term-listing";

type Props = PageProps<"/s/[store]/[market]/category/[slug]">;

/** A store's products in a category, with its subcategories (D50). */
export function generateStaticParams({ params }: { params: { store: string; market: string } }) {
  return termStaticParams("category", params);
}

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return termMetadata("category", params);
}

export default function Page({ params }: Props) {
  return <TermProducts kind="category" params={params} />;
}
