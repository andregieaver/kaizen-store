import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackToAdmin } from "@/components/back-to-admin";
import { StoreThemeStyles } from "@/components/store-theme";
import { t } from "@/lib/i18n";
import { marketPath, storeHome, storeSiteUrl } from "@/lib/paths";
import { themeAttributes } from "@/lib/theme";
import { siteFontStyle } from "@/server/fonts";
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
  const base = storeHome(store.slug);
  const description =
    store.seo.description[market.locale] || t(market.lang).storeSummary(store.name, store.markets.map((m) => m.name).join(", "));
  return {
    metadataBase: new URL(storeSiteUrl(store.slug)),
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
    <html lang={store.markets[0]?.lang ?? "en"} className="h-full antialiased" {...themeAttributes(store.theme.settings)}>
      <body className="flex min-h-full flex-col font-sans" style={siteFontStyle(store.fonts)}>
        {/* The store's own fonts (D59) and theme (D60), as in its markets. */}
        <StoreThemeStyles store={store} />
        {children}
        <BackToAdmin storeSlug={store.slug} />
      </body>
    </html>
  );
}
