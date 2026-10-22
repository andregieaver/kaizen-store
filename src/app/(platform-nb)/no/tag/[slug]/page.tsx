import type { Metadata } from "next";

import { termMetadata, termStaticParams, TermPages } from "@/components/platform-routes/terms";

type Props = PageProps<"/no/tag/[slug]">;

export function generateStaticParams() {
  return termStaticParams("tag", "page");
}

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return termMetadata("tag", params, "page", "nb");
}

export default function Page({ params }: Props) {
  return <TermPages kind="tag" params={params} lang="nb" />;
}
