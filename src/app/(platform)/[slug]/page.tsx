import type { Metadata } from "next";

import { PageRoute, pageMetadata, pageStaticParams, slugOf } from "@/components/platform-routes/page";

type Props = PageProps<"/[slug]">;

export function generateStaticParams() {
  return pageStaticParams(false);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return pageMetadata("en", await slugOf(params));
}

/** One of Kaizen's own pages in English (D42, D312). */
export default async function PlatformPage({ params, searchParams }: Props) {
  return <PageRoute lang="en" slug={await slugOf(params)} searchParams={searchParams} />;
}
