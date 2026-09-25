import type { Metadata } from "next";

import { blogTermMetadata, blogTermStaticParams, StoreBlogTerm } from "../../blog-listing";

type Props = PageProps<"/s/[store]/[market]/blog/category/[slug]">;

/** A store's articles in a category, with its subcategories (D57). */
export function generateStaticParams({ params }: { params: { store: string; market: string } }) {
  return blogTermStaticParams("category", params);
}

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return blogTermMetadata("category", params);
}

export default function Page({ params }: Props) {
  return <StoreBlogTerm kind="category" params={params} />;
}
