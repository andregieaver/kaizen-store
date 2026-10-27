import type { Metadata } from "next";

import { articleMetadata, otherBlogArticleParams, StoreArticle } from "../../../blog/article-page";

type Props = PageProps<"/s/[store]/[market]/blogs/[blog]/[slug]">;

/** Another blog's articles (D341) at `/blogs/{handle}/{slug}`; an article of the first blog moves to `/blog/{slug}`. */
export async function generateStaticParams({ params }: { params: { store: string; market: string } }) {
  return otherBlogArticleParams(params);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, market, slug, blog } = await params;
  return articleMetadata(Promise.resolve({ store, market, slug }), blog);
}

export default async function Page({ params }: Props) {
  const { store, market, slug, blog } = await params;
  return <StoreArticle params={Promise.resolve({ store, market, slug })} handle={blog} />;
}
