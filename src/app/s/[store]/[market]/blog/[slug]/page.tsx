import type { Metadata } from "next";

import { articleMetadata, articleStaticParams, StoreArticle } from "../article-page";

type Props = PageProps<"/s/[store]/[market]/blog/[slug]">;

/** The first blog's articles (D57) at `/blog/{slug}`; an article of another blog (D341) moves to its own blog's address. */
export async function generateStaticParams({ params }: { params: { store: string; market: string } }) {
  return articleStaticParams(params, null);
}

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return articleMetadata(params, null);
}

export default function StoreArticlePage({ params }: Props) {
  return <StoreArticle params={params} handle={null} />;
}
