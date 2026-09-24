import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackToAdmin } from "@/components/back-to-admin";
import { t } from "@/lib/i18n";
import { marketPath, storeBase } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { storeShareImage, storeShareTags, verificationTags } from "@/server/seo";
import { templateStoreSlug, getOpenStore } from "@/server/stores";

import "../../../globals.css";

type Props = LayoutProps<"/s/[store]">;

export async function generateStaticParams() {
  const slug = await templateStoreSlug();
  return [{ store: slug ?? "_" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const store = await getOpenStore((await params).store);
  const market = store?.markets[0];
  if (!store || !market) return {};
  const base = storeBase(store.slug);
  const description =
    store.seo.description[market.locale] || t(market.lang).storeSummary(store.name, store.markets.map((m) => m.name).join(", "));
  return {
    metadataBase: new URL(siteUrl()),
    title: store.name,
    description,
    ...(!(store.setupCompletedAt || store.isTemplate) || store.seo.hidden ? { robots: { index: false } } : {}),
    alternates: {
      canonical: base,
      languages: {
        ...Object.fromEntries(store.markets.map((m) => [m.locale, marketPath(store.slug, m.slug)])),
        "x-default": base,
      },
    },
    ...storeShareTags(store, market, {
      title: store.name,
      description,
      url: base,
      images: [storeShareImage(store, market.locale)],
    }),
    verification: verificationTags(store.seo),
  };
}

export default async function ChooserLayout({ children, params }: Props) {
  const store = await getOpenStore((await params).store);
  if (!store) notFound();
  return (
    <html lang={store.markets[0]?.lang ?? "en"} className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <BackToAdmin storeSlug={store.slug} />
      </body>
    </html>
  );
}
