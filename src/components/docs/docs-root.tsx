import type { Metadata } from "next";

import { StoreThemeStyles } from "@/components/store-theme";
import { docsOrigin } from "@/lib/docs-host";
import { PLATFORM_LANG_FACTS, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { siteUrl } from "@/lib/site";
import { siteIcons } from "@/lib/site-icons";
import { themeAttributes } from "@/lib/theme";
import { siteFontStyle } from "@/server/fonts";
import { getPlatformFavicon, getPlatformTheme } from "@/server/platform-navigation";

/** The docs' metadata in a language: their own title and description, on their own host's address when they have one (D442). */
export async function docsRootMetadata(lang: PlatformLang): Promise<Metadata> {
  const words = platformText(lang).docs;
  return {
    metadataBase: new URL(docsOrigin() ?? siteUrl()),
    title: { default: words.title, template: `%s · ${words.title}` },
    description: words.description,
    openGraph: { type: "website", siteName: words.title, locale: PLATFORM_LANG_FACTS[lang].ogLocale },
    icons: siteIcons(await getPlatformFavicon()),
  };
}

/**
 * The docs portal's root (wave 14 unit E1, D442): a root layout of its own, as the theme store's preview has (D275), so a docs page carries
 * only its frame and its article, never Kaizena Flow's header, footer, chat or banner, and loads no script but its few interactive parts.
 * Drawn in Kaizena Flow's own theme (D235): its colours, fonts and light or dark mode as Kaizena Flow's pages are (D99: the theme's mode,
 * else the device's). Each language is a root of its own, for its `<html lang>`.
 */
export async function DocsRoot({ lang, children }: { lang: PlatformLang; children: React.ReactNode }) {
  const theme = await getPlatformTheme();
  const fonts = theme.settings.fonts;
  return (
    <html lang={PLATFORM_LANG_FACTS[lang].tag} className="antialiased" {...themeAttributes(theme.settings)}>
      <body className="min-h-dvh bg-background font-sans text-foreground" style={siteFontStyle(fonts)}>
        <StoreThemeStyles store={{ id: "kaizen", theme, fonts }} />
        {children}
      </body>
    </html>
  );
}
