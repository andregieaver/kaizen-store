import type { Metadata } from "next";

import { blogTermMetadata, blogTermStaticParams, StoreBlogTerm } from "../../../../blog/blog-listing";

type Props = PageProps<"/s/[store]/[market]/blogs/[blog]/category/[slug]">;

/** Another blog's articles in a category, with its subcategories (D341). */
export function generateStaticParams({ params }: { params: { store: string; market: string } }) {
  return blogTermStaticParams("category", params);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, market, slug, blog } = await params;
  return blogTermMetadata("category", Promise.resolve({ store, market, slug }), blog);
}

export default async function Page({ params }: Props) {
  const { store, market, slug, blog } = await params;
  return <StoreBlogTerm kind="category" params={Promise.resolve({ store, market, slug })} handle={blog} />;
}
