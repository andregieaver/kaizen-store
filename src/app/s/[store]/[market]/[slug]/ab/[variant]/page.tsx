import type { Metadata } from "next";

import { StorePageView, storePageMetadata } from "../../store-page-view";

type Props = { params: Promise<{ store: string; market: string; slug: string; variant: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * A version of a page made for an A/B test (D148): the page at its own address with the version's content, reached only
 * by the proxy's rewrite for visitors who were given it. Never indexed; its canonical address is the original's. Versions
 * are made while the site runs, so they are drawn on first request and cached from then on.
 */
export async function generateStaticParams() {
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return [{ slug: "_", variant: "b" }];
}

const KEYS = ["a", "b", "c", "d"];
const keyOf = async (params: Props["params"]) => {
  const { variant } = await params;
  return KEYS.includes(variant) ? variant : null;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return storePageMetadata(params, (await keyOf(params)) ?? "a");
}

export default async function StorePageVariant({ params, searchParams }: Props) {
  return <StorePageView params={params} searchParams={searchParams} variant={await keyOf(params)} />;
}
