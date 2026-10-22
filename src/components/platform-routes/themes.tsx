import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { JsonLdScript } from "@/components/json-ld";
import { platformPageMetadata, PlatformPageView } from "@/components/platform-page";
import { ThemeDetailsPart, ThemeFeaturesPart, ThemeHighlightsPart, ThemeLivePart, ThemePicturesPart, ThemeStagePart } from "@/components/theme-page-parts";
import { ThemeStoreList } from "@/components/theme-store-view";
import { platformPath, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { siteUrl } from "@/lib/site";
import { inLanguage, parseThemeFilter, sharePicture, themeJsonLd, type ThemeStoreCard } from "@/lib/theme-store";
import { themeStoreAlternates, themeStoreUrl, themesHost } from "@/lib/theme-host";
import { themePartsWith } from "@/lib/theme-store-parts";
import { isPremium } from "@/lib/theme-prices";
import { getPlatformLangs } from "@/server/platform-navigation";
import { platformPageForRole } from "@/server/platform-roles";
import { themeStoreCards, themeStorePage } from "@/server/theme-store";

type Query = Promise<Record<string, string | string[] | undefined>>;

/** A theme store page's canonical address on its own host where it has one, and its addresses in each language offered (D312 P3). */
async function alternates(sub: string, lang: PlatformLang): Promise<Metadata["alternates"]> {
  const languages = themeStoreAlternates(sub, await getPlatformLangs());
  return { canonical: themeStoreUrl(sub, lang), ...(languages && { languages }) };
}

export async function themesMetadata(lang: PlatformLang): Promise<Metadata> {
  // A page built for it (D285) has its own search texts; either way its address is its own host's once it has one (`docs/theme-phase-3.md` step 3).
  const [page, alt] = await Promise.all([platformPageForRole("themes"), alternates("", lang)]);
  if (page) return { ...platformPageMetadata(page, themeStoreUrl("", lang), { lang }), alternates: alt };
  const w = platformText(lang).themeStore;
  return { title: w.title, description: w.description, alternates: alt };
}

/**
 * The theme store's list (`docs/theme-phase-3.md` step 1) in `lang` (D312 P3): every published theme, filtered by the address. The unfiltered
 * list is prerendered as the fallback, so search engines and a first visit read every theme at once. A page built for it in Kaizena Flow's
 * page builder (D285, edited from Themes) is drawn instead while it is published, its Themes component the same list.
 */
export async function ThemesRoute({ lang, searchParams }: { lang: PlatformLang; searchParams: Query }) {
  const page = await platformPageForRole("themes");
  if (page) return <PlatformPageView page={page} url="/themes" query={searchParams} lang={lang} />;
  const w = platformText(lang).themeStore;
  const cards = (await themeStoreCards()).map((card) => inLanguage(card, lang));
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{w.title}</h1>
        <p className="max-w-2xl text-muted">{w.intro}</p>
      </div>
      <Suspense fallback={<ThemeStoreList cards={cards} filter={{ kind: null, style: null, feature: null }} lang={lang} />}>
        <Filtered cards={cards} searchParams={searchParams} lang={lang} />
      </Suspense>
    </main>
  );
}

async function Filtered({ cards, searchParams, lang }: { cards: ThemeStoreCard[]; searchParams: Query; lang: PlatformLang }) {
  return <ThemeStoreList cards={cards} filter={parseThemeFilter(await searchParams)} lang={lang} />;
}

/** Every theme's page is prerendered; one published later is drawn on its first visit. */
export async function themeStaticParams() {
  const cards = await themeStoreCards();
  return cards.length > 0 ? cards.map((card) => ({ slug: card.slug })) : [{ slug: "__none__" }];
}

export async function themeMetadata(lang: PlatformLang, slug: string): Promise<Metadata> {
  const w = platformText(lang).themeStore.meta;
  const found = await themeStorePage(slug);
  if (!found) return { title: w.notFound, robots: { index: false } };
  const theme = inLanguage(found, lang);
  const description = theme.summary || w.themeDescription(theme.title, !isPremium(theme.prices ?? []));
  const title = w.themeTitle(theme.title);
  return {
    title,
    description,
    alternates: await alternates(theme.slug, lang),
    // Its own picture, else the one made from its photograph (`docs/theme-showcase-phase-2.md`), else one drawn from its colours
    // (`/themes/{slug}/og.png`, on Kaizena Flow's host, by full address).
    openGraph: { title, description, images: [{ url: sharePicture(theme) ?? `${siteUrl()}/themes/${theme.slug}/og.png`, alt: "" }] },
  };
}

/**
 * A theme's page in the theme store (D275, `docs/themes-content-and-demo-stores.md` section 6) in `lang` (D312 P3), written for Homer: the
 * theme large, a computer and a phone showing the chosen look on its own content with its presets as swatches under them, *Use this theme*
 * and *Preview* (full screen) for the chosen look, the demo stores wearing it (*See it live*, D277), its highlights, what one gets, and the
 * details folded away for Lisa. A page built for it in Kaizena Flow's page builder (D285, edited from Themes) is drawn instead while it is
 * published, its theme store components showing this theme; the structured data stays the theme's.
 */
export async function ThemeRoute({ lang, slug }: { lang: PlatformLang; slug: string }) {
  const [found, page] = await Promise.all([themeStorePage(slug), platformPageForRole("theme")]);
  if (!found) {
    // On the theme store's own host every one-part address comes here: one that is no theme is Kaizena Flow's own (the header's
    // `/pricing`, `/sign-up`), so it goes there (`docs/theme-phase-3.md` step 3). Without the host, `/themes/{slug}` has nothing else.
    if (themesHost()) redirect(`${siteUrl()}${platformPath(lang, `/${slug}`)}`);
    notFound();
  }
  const theme = inLanguage(found, lang);
  const url = themeStoreUrl(theme.slug, lang);
  const jsonLd = <JsonLdScript data={themeJsonLd({ ...theme, pictureUrl: sharePicture(theme) }, url, "Kaizena Flow")} />;
  if (page) {
    return (
      <>
        {jsonLd}
        <PlatformPageView page={page} url={`/themes/${theme.slug}`} themeSlug={theme.slug} themeParts={themePartsWith(theme)} jsonLd={false} lang={lang} />
      </>
    );
  }
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-14 px-4 py-8">
      {jsonLd}
      <ThemeStagePart theme={theme} lang={lang} />
      <ThemeLivePart theme={theme} lang={lang} />
      <ThemeHighlightsPart theme={theme} lang={lang} />
      <ThemePicturesPart theme={theme} lang={lang} />
      <ThemeFeaturesPart theme={theme} lang={lang} />
      <ThemeDetailsPart theme={theme} lang={lang} />
    </main>
  );
}
