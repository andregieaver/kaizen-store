import type { Metadata } from "next";

import { PageRoute, pageMetadata, pageStaticParams, slugOf } from "@/components/platform-routes/page";

type Props = PageProps<"/[slug]/[...sub]">;

/** Kaizen's pages nested under another (`/projects/project-a`), drawn like any other. */
export function generateStaticParams() {
  return pageStaticParams(true);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return pageMetadata("en", await slugOf(params));
}

export default async function NestedPlatformPage({ params, searchParams }: Props) {
  return <PageRoute lang="en" slug={await slugOf(params)} searchParams={searchParams} />;
}
