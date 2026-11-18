import type { Metadata } from "next";

import { blogTermMetadata, blogTermStaticParams, StoreBlogTerm } from "../../blog-listing";

type Props = PageProps<"/s/[store]/[market]/blog/tag/[slug]">;

/** A store's articles with a tag (D57). */
export function generateStaticParams({ params }: { params: { store: string; market: string } }) {
  return blogTermStaticParams("tag", params);
}

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return blogTermMetadata("tag", params);
}

export default function Page({ params }: Props) {
  return <StoreBlogTerm kind="tag" params={params} />;
}
