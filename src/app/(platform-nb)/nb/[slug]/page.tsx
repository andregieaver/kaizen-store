import type { Metadata } from "next";

import { PageRoute, pageMetadata, pageStaticParams, slugOf } from "@/components/platform-routes/page";

type Props = PageProps<"/nb/[slug]">;

export function generateStaticParams() {
  return pageStaticParams(false);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return pageMetadata("nb", await slugOf(params));
}

export default async function NorwegianPage({ params, searchParams }: Props) {
  return <PageRoute lang="nb" slug={await slugOf(params)} searchParams={searchParams} />;
}
