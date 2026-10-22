import type { Metadata } from "next";

import { termMetadata, termStaticParams, TermPages } from "@/components/platform-routes/terms";

type Props = PageProps<"/no/blog/tag/[slug]">;

export function generateStaticParams() {
  return termStaticParams("tag", "article");
}

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return termMetadata("tag", params, "article", "nb");
}

export default function Page({ params }: Props) {
  return <TermPages kind="tag" params={params} type="article" lang="nb" />;
}
