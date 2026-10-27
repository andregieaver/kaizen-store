import type { Metadata } from "next";

import { blogTermMetadata, blogTermStaticParams, StoreBlogTerm } from "../../../../blog/blog-listing";

type Props = PageProps<"/s/[store]/[market]/blogs/[blog]/tag/[slug]">;

/** Another blog's articles with a tag (D341). */
export function generateStaticParams({ params }: { params: { store: string; market: string } }) {
  return blogTermStaticParams("tag", params);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, market, slug, blog } = await params;
  return blogTermMetadata("tag", Promise.resolve({ store, market, slug }), blog);
}

export default async function Page({ params }: Props) {
  const { store, market, slug, blog } = await params;
  return <StoreBlogTerm kind="tag" params={Promise.resolve({ store, market, slug })} handle={blog} />;
}
