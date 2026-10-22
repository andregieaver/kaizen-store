import type { Metadata } from "next";

import { ArticleRoute, articleMetadata, articleStaticParams } from "@/components/platform-routes/blog";

type Props = PageProps<"/nb/blog/[slug]">;

export function generateStaticParams() {
  return articleStaticParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return articleMetadata("nb", (await params).slug);
}

export default async function NorwegianArticle({ params }: Props) {
  return <ArticleRoute lang="nb" slug={(await params).slug} />;
}
