import type { Metadata } from "next";

import { termMetadata, termStaticParams, TermProducts } from "../../term-listing";

type Props = PageProps<"/s/[store]/[market]/tag/[slug]">;

/** A store's products with a tag (D50). */
export function generateStaticParams({ params }: { params: { store: string; market: string } }) {
  return termStaticParams("tag", params);
}

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return termMetadata("tag", params);
}

export default function Page({ params }: Props) {
  return <TermProducts kind="tag" params={params} />;
}
