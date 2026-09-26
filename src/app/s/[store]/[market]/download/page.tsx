import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { t, type Messages } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/download">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Where a download link that no longer works lands (D24). */
export default async function DownloadNotice({ params, searchParams }: Props) {
  const { store, market } = await params;
  const shop = await resolveShop(store, market);
  if (!shop) notFound();
  const m = t(shop.market.lang);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-8">
      <h1 className="text-2xl font-heading">{m.downloads}</h1>
      <Suspense fallback={<p>{m.downloadGone}</p>}>
        <Problem searchParams={searchParams} m={m} />
      </Suspense>
      <Link href={marketPath(shop.store.slug, shop.market.slug)} className="underline">
        {m.continueShopping}
      </Link>
    </div>
  );
}

async function Problem({ searchParams, m }: { searchParams: Props["searchParams"]; m: Messages }) {
  const { problem } = await searchParams;
  return <p role="alert">{problem === "failed" ? m.downloadFailed : m.downloadGone}</p>;
}
