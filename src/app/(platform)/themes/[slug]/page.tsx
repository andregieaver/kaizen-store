import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { JsonLdScript } from "@/components/json-ld";
import { PlatformPageView } from "@/components/platform-page";
import { ThemeDetailsPart, ThemeFeaturesPart, ThemeHighlightsPart, ThemeLivePart, ThemePicturesPart, ThemeStagePart } from "@/components/theme-page-parts";
import { siteUrl } from "@/lib/site";
import { sharePicture, themeJsonLd } from "@/lib/theme-store";
import { themePartsWith } from "@/lib/theme-store-parts";
import { platformPageForRole } from "@/server/platform-roles";
import { themeStoreCards, themeStorePage } from "@/server/theme-store";
import { themeStoreUrl, themesHost } from "@/lib/theme-host";

/** Every theme's page is prerendered; one published later is drawn on its first visit. */
export async function generateStaticParams() {
  const cards = await themeStoreCards();
  return cards.length > 0 ? cards.map((card) => ({ slug: card.slug })) : [{ slug: "__none__" }];
}

export async function generateMetadata({ params }: PageProps<"/themes/[slug]">): Promise<Metadata> {
  const theme = await themeStorePage((await params).slug);
  if (!theme) return { title: "Theme not found", robots: { index: false } };
  const description = theme.summary || `${theme.title}, a free theme for Kaizena Flow stores.`;
  return {
    title: `${theme.title} theme`,
    description,
    alternates: { canonical: themeStoreUrl(theme.slug) },
    // Its own picture, else the one made from its photograph (`docs/theme-showcase-phase-2.md`), else one drawn from its colours
    // (`/themes/{slug}/og.png`, on Kaizena Flow's host, by full address).
    openGraph: { title: `${theme.title} theme`, description, images: [{ url: sharePicture(theme) ?? `${siteUrl()}/themes/${theme.slug}/og.png`, alt: "" }] },
  };
}

/**
 * A theme's page in the theme store (D275, `docs/themes-content-and-demo-stores.md` section 6), written for Homer: the theme large, a
 * computer and a phone showing the chosen look on its own content with its presets as swatches under them, *Use this theme* and *Preview*
 * (full screen) for the chosen look, the demo stores wearing it (*See it live*, D277), its highlights, what one gets, and the details folded
 * away for Lisa. Free; no price anywhere.
 */
/**
 * A theme's page in the theme store (D275, `docs/themes-content-and-demo-stores.md` section 6), written for Homer: the theme large, a
 * computer and a phone showing the chosen look on its own content with its presets as swatches under them, *Use this theme* and *Preview*
 * (full screen) for the chosen look, the demo stores wearing it (*See it live*, D277), its highlights, what one gets, and the details folded
 * away for Lisa. Free; no price anywhere. A page built for it in Kaizena Flow's page builder (D285, edited from Themes) is drawn instead
 * while it is published, its theme store components showing this theme; the structured data stays the theme's.
 */
export default async function ThemePage({ params }: PageProps<"/themes/[slug]">) {
  const { slug } = await params;
  const [theme, page] = await Promise.all([themeStorePage(slug), platformPageForRole("theme")]);
  if (!theme) {
    // On the theme store's own host every one-part address comes here: one that is no theme is Kaizena Flow's own (the header's
    // `/pricing`, `/sign-up`), so it goes there (`docs/theme-phase-3.md` step 3). Without the host, `/themes/{slug}` has nothing else.
    if (themesHost()) redirect(`${siteUrl()}/${slug}`);
    notFound();
  }
  const url = themeStoreUrl(theme.slug);
  const jsonLd = <JsonLdScript data={themeJsonLd({ ...theme, pictureUrl: sharePicture(theme) }, url, "Kaizena Flow")} />;
  if (page) {
    return (
      <>
        {jsonLd}
        <PlatformPageView page={page} url={`/themes/${theme.slug}`} themeSlug={theme.slug} themeParts={themePartsWith(theme)} jsonLd={false} />
      </>
    );
  }
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-14 px-4 py-8">
      {jsonLd}
      <ThemeStagePart theme={theme} />
      <ThemeLivePart theme={theme} />
      <ThemeHighlightsPart theme={theme} />
      <ThemePicturesPart theme={theme} />
      <ThemeFeaturesPart theme={theme} />
      <ThemeDetailsPart theme={theme} />
    </main>
  );
}
