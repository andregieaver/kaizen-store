import type { Metadata } from "next";

import { termMetadata, termStaticParams, TermPages } from "@/components/platform-routes/terms";

type Props = PageProps<"/no/blog/category/[slug]">;

export function generateStaticParams() {
  return termStaticParams("category", "article");
}

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return termMetadata("category", params, "article", "nb");
}

export default function Page({ params }: Props) {
  return <TermPages kind="category" params={params} type="article" lang="nb" />;
}
