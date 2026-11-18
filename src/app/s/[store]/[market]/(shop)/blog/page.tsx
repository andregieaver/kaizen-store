import type { Metadata } from "next";

import { blogMetadata, StoreBlog } from "./blog-listing";

type Props = PageProps<"/s/[store]/[market]/blog">;

/** A store's blog (D57): its articles, newest first. */
export function generateMetadata({ params }: Props): Promise<Metadata> {
  return blogMetadata(params);
}

export default function Page({ params }: Props) {
  return <StoreBlog params={params} />;
}
