import type { Metadata } from "next";

import { StoreThemeStyles } from "@/components/store-theme";
import { PLATFORM_LANG_FACTS, type PlatformLang } from "@/lib/platform-lang";
import { siteUrl } from "@/lib/site";
import { siteIcons } from "@/lib/site-icons";
import { themeAttributes } from "@/lib/theme";
import { siteFontStyle } from "@/server/fonts";
import { getPlatformChrome, getPlatformFavicon } from "@/server/platform-navigation";

export async function themePreviewRootMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(siteUrl()),
    // The theme's own page is the one for search engines; the full-screen preview is a view of it.
    robots: { index: false, follow: true },
    icons: siteIcons(await getPlatformFavicon()),
  };
}

/**
 * A theme's full-screen preview in the theme store (D275, `docs/themes-content-and-demo-stores.md` section 6): a root of its own, so the
 * page is the slim bar and the store under it, without Kaizena Flow's header, footer, chat or banner. The bar is drawn in Kaizena Flow's
 * own theme (D235), as its pages are, in `lang` (D312 P3: each language's preview is a root of its own, for its `<html lang>`).
 */
export async function ThemePreviewRoot({ lang, children }: { lang: PlatformLang; children: React.ReactNode }) {
  const chrome = await getPlatformChrome();
  return (
    <html lang={PLATFORM_LANG_FACTS[lang].tag} className="h-full antialiased" {...themeAttributes(chrome.theme.settings)}>
      <body className="flex h-dvh flex-col overflow-hidden bg-background font-sans text-foreground" style={siteFontStyle(chrome.fonts)}>
        <StoreThemeStyles store={{ id: "kaizen", theme: chrome.theme, fonts: chrome.fonts }} />
        {children}
      </body>
    </html>
  );
}
