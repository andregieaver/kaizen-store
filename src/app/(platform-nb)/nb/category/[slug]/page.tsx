import type { Metadata } from "next";

import { termMetadata, termStaticParams, TermPages } from "@/components/platform-routes/terms";

type Props = PageProps<"/nb/category/[slug]">;

export function generateStaticParams() {
  return termStaticParams("category", "page");
}

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return termMetadata("category", params, "page", "nb");
}

export default function Page({ params }: Props) {
  return <TermPages kind="category" params={params} lang="nb" />;
}
