import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CustomCss } from "@/components/custom-css";
import { StoreColorScript } from "@/components/store-color-switch";
import { StoreThemeStyles } from "@/components/store-theme";
import { siteIcons } from "@/lib/site-icons";
import { themeAttributes } from "@/lib/theme";
import { siteFontStyle } from "@/server/fonts";
import { resolveShop } from "@/server/shop";

import "../../../../globals.css";

type Props = LayoutProps<"/s/[store]/private/[market]">;

/** Drawn on request for a store that is private; "_" only gives Cache Components an entry (it is not found). */
export function generateStaticParams() {
  return [{ store: "_", market: "_" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return {};
  // Never for search engines (D339): the proxy also marks the response itself.
  return { title: shop.store.name, robots: { index: false, follow: false }, icons: siteIcons(shop.store.navigation.favicon) };
}

/**
 * A private store's landing page (D339, `docs/wave-7-storefront.md` E) has a root layout of its own: the store's theme, fonts and CSS, and
 * nothing of the store's header, footer, search, cart, chat or extras, so nothing on it reaches the catalogue or another site's code.
 */
export default async function PrivateLayout({ children, params }: Props) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  return (
    <html lang={market.lang} className="h-full antialiased" {...themeAttributes(store.theme.settings)} suppressHydrationWarning={store.theme.settings.visitorSwitch}>
      <body className="flex min-h-full flex-col font-sans" style={siteFontStyle(store.fonts)}>
        <StoreColorScript store={store} />
        <StoreThemeStyles store={store} />
        <CustomCss css={store.customCss} name={`store-${store.id}`} />
        <main id="main" className="mx-auto flex w-full max-w-(--content-width) flex-1 flex-col justify-center px-4 py-8 has-[>.store-page]:max-w-none has-[>.store-page]:p-0">
          {children}
        </main>
      </body>
    </html>
  );
}
