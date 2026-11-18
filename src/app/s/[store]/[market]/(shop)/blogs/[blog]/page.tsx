import type { Metadata } from "next";

import { blogMetadata, otherBlogsStaticParams, StoreBlog } from "../../blog/blog-listing";

type Props = PageProps<"/s/[store]/[market]/blogs/[blog]">;

/** A store's other blogs (D341) at `/blogs/{handle}`: its articles, newest first, or the page chosen to stand there. */
export function generateStaticParams({ params }: { params: { store: string; market: string } }) {
  return otherBlogsStaticParams(params);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, market, blog } = await params;
  return blogMetadata(Promise.resolve({ store, market }), blog);
}

export default async function Page({ params }: Props) {
  const { store, market, blog } = await params;
  return <StoreBlog params={Promise.resolve({ store, market })} handle={blog} />;
}
