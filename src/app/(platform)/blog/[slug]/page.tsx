import type { Metadata } from "next";

import { ArticleRoute, articleMetadata, articleStaticParams } from "@/components/platform-routes/blog";

type Props = PageProps<"/blog/[slug]">;

export function generateStaticParams() {
  return articleStaticParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return articleMetadata("en", (await params).slug);
}

/** One of Kaizen's articles in English (D57, D312). */
export default async function ArticlePage({ params }: Props) {
  return <ArticleRoute lang="en" slug={(await params).slug} />;
}
