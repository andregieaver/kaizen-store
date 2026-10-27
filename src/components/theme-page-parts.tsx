import Link from "next/link";
import { Suspense } from "react";

import { SeeItLive } from "@/components/see-it-live";
import { ThemePreviewStage, type StageLook } from "@/components/theme-preview-stage";
import { designPreviewPath } from "@/lib/design-presets";
import { PLATFORM_LANG_FACTS, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { isCoreSectionStyle, sectionStyleLabel } from "@/lib/section-styles";
import { shownLooks, themePreviewPath, themeStartLink, themeTryLink } from "@/lib/theme-store";
import { withThemeName } from "@/lib/theme-store-parts";
import { platformHref, themeStorePath } from "@/lib/theme-host";
import { isPremium, pricesText } from "@/lib/theme-prices";
import { liveDemosOf } from "@/server/demo-stores";
import type { ThemeStorePage } from "@/server/theme-store";

/**
 * The parts of a theme's page in the theme store (D275, D276, D285): the standard page draws them one under another, and a page built in
 * Kaizena Flow's page builder draws each where its theme store component is (`ThemeStoreSection`). Each takes the heading and line it
 * draws (the standard page's own words in the page's language unless the page says otherwise, D312 P3) and draws nothing when it has
 * nothing for the theme. Words the theme has only in English are marked so (`lang="en"`).
 */

/** `lang="en"` on what stays English on a page in another language. */
const english = (lang: PlatformLang, shown = true) => (lang !== "en" && shown ? { lang: "en" } : {});

/** What a theme's page says of its price: free, or what a store pays and when, as the language writes money. */
function priceLineIn(prices: ThemeStorePage["prices"], lang: PlatformLang): string {
  const w = platformText(lang).themeStore;
  return prices && isPremium(prices) ? w.priceLine(pricesText(prices, [], PLATFORM_LANG_FACTS[lang].locale)) : w.free;
}

/**
 * The theme's looks for the stage: every look is shown on the theme's own content once it is published (D275), never on the Standard store
 * (D274); until then its colours. Kaizena Flow's own site serves the live preview, sign-up and the try route: full addresses while the theme
 * store has its own host.
 */
export function stageLooks(theme: ThemeStorePage, lang: PlatformLang = "en"): StageLook[] {
  const shown = new Set(shownLooks(theme.looks).map((look) => look.key));
  return theme.looks.map((look) => {
    const preview = shown.has(look.key);
    const starter = look.showcase?.starterId ?? null;
    return {
      key: look.key,
      name: look.name,
      swatch: look.swatch ?? theme.swatch,
      frameHref: preview ? platformHref(designPreviewPath(theme.id, starter, false, false, true, look.key)) : null,
      previewHref: preview ? themePreviewPath(theme.slug, look.key, {}, lang) : null,
      tryHref: platformHref(themeTryLink(theme.slug, look.key)),
      startHref: platformHref(themeStartLink(theme.id, look.key, lang)),
      computerPoster: look.shots?.computer?.screen?.url ?? null,
      phonePoster: look.shots?.phone?.screen?.url ?? null,
    };
  });
}

/** The way back to the list, the theme large in a computer and a phone, its presets, *Use this theme* and *Preview*. */
export function ThemeStagePart({ theme, lang = "en" }: { theme: ThemeStorePage; lang?: PlatformLang }) {
  const w = platformText(lang).themeStore;
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={w.stage.breadcrumb} className="text-sm">
        <Link href={themeStorePath("", lang)} className="underline underline-offset-2">
          {w.stage.themes}
        </Link>
      </nav>
      <ThemePreviewStage
        title={theme.title}
        looks={stageLooks(theme, lang)}
        words={w.stage}
        heading={
          <>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{theme.title}</h1>
            {theme.summary && (
              <p className="text-lg text-muted" {...english(lang, theme.english?.summary)}>
                {theme.summary}
              </p>
            )}
            <p className="text-sm text-muted" data-theme-price="">
              {priceLineIn(theme.prices, lang)}
              {theme.presets.length > 0 ? ` · ${w.presets(theme.presets.length + 1)}` : ""}
            </p>
          </>
        }
      />
    </div>
  );
}

type Words = { heading?: string; text?: string; lang?: PlatformLang };

/** The demo stores wearing one of its looks (D277), read every few minutes: the page itself stays prerendered. */
export function ThemeLivePart({ theme, lang = "en", heading, text }: { theme: ThemeStorePage } & Words) {
  const w = platformText(lang).themeStore.live;
  return (
    <Suspense fallback={null}>
      <LiveDemos theme={theme} lang={lang} heading={heading ?? w.heading} text={withThemeName(text ?? w.text, theme.title)} />
    </Suspense>
  );
}

async function LiveDemos({ theme, heading, text, lang = "en" }: { theme: ThemeStorePage } & Words) {
  const demos = await liveDemosOf(theme.id);
  return <SeeItLive title={theme.title} demos={demos} looks={stageLooks(theme, lang)} heading={heading} text={text} wears={platformText(lang).themeStore.live.wears} />;
}

/** Pictures composed from its photographs, with words a person wrote or accepted (`docs/theme-showcase-phase-2.md` step 2). */
export function ThemeHighlightsPart({ theme, lang = "en", heading = platformText(lang).themeStore.highlights.heading }: { theme: ThemeStorePage } & Words) {
  const w = platformText(lang).themeStore.highlights;
  const highlights = theme.highlights ?? [];
  if (highlights.length === 0) return null;
  return (
    <section aria-labelledby={heading ? "highlights" : undefined} aria-label={heading ? undefined : w.heading} className="flex flex-col gap-6">
      {heading && (
        <h2 id="highlights" className="text-2xl font-semibold tracking-tight" data-kz-text="title">
          {heading}
        </h2>
      )}
      <ul className="grid gap-8 md:grid-cols-3" data-highlights="">
        {highlights.map((highlight) => (
          <li key={highlight.kind}>
            <figure className="flex flex-col gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- made pictures, in Kaizena Flow's own bucket */}
              <img src={highlight.url} alt={`${theme.title}: ${w[highlight.kind].toLowerCase()}`} width={highlight.width} height={highlight.height} loading="lazy" className="w-full rounded-lg" />
              {highlight.title && (
                <figcaption className="flex flex-col gap-1" {...english(lang, theme.english?.highlights)}>
                  <span className="font-medium">{highlight.title}</span>
                  {highlight.text && <span className="text-sm text-muted">{highlight.text}</span>}
                </figcaption>
              )}
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Its own pictures, chosen by a person (D250); the frames already show what it looks like. */
export function ThemePicturesPart({ theme, lang = "en" }: { theme: ThemeStorePage; lang?: PlatformLang }) {
  const w = platformText(lang).themeStore.pictures;
  const own = [theme.pictureUrl, ...theme.listing.pictures].filter((url): url is string => Boolean(url));
  if (own.length === 0) return null;
  return (
    <section aria-label={w.label} className="flex flex-col gap-4">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {own.map((picture, index) => (
          <li key={picture}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the theme's own pictures, from Kaizena Flow's media library */}
            <img src={picture} alt={w.picture(theme.title, index + 1)} loading="lazy" className="aspect-video w-full rounded-lg border border-border object-cover" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the theme includes, from its published version (`themeFeatures()`), never typed in. */
export function ThemeFeaturesPart({ theme, lang = "en", heading, text }: { theme: ThemeStorePage } & Words) {
  const w = platformText(lang).themeStore;
  heading ??= w.whatYouGet.heading;
  text ??= w.whatYouGet.text;
  if (theme.features.length === 0) return null;
  return (
    <section aria-labelledby={heading ? "what-you-get" : undefined} aria-label={heading ? undefined : w.whatYouGet.heading} className="flex flex-col gap-4">
      {heading && (
        <h2 id="what-you-get" className="text-2xl font-semibold tracking-tight" data-kz-text="title">
          {heading}
        </h2>
      )}
      <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {theme.features.map((feature) => (
          <li key={feature} className="flex gap-2">
            <span aria-hidden="true">✓</span>
            <span>{w.features[feature]}</span>
          </li>
        ))}
      </ul>
      {text && <p className="text-muted">{withThemeName(text, theme.title)}</p>}
    </section>
  );
}

/** For Lisa: one deliberate step away (CLAUDE.md, Homer and Lisa): what it suits, its style and version, and its changelog. */
export function ThemeDetailsPart({ theme, lang = "en", heading }: { theme: ThemeStorePage } & Words) {
  const w = platformText(lang).themeStore;
  const d = w.details;
  const styleName = (name: string) => (isCoreSectionStyle(name) ? w.sectionStyles[name] : sectionStyleLabel(name));
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 font-medium marker:hidden [&::-webkit-details-marker]:hidden">
        <span data-kz-text="title">{heading || d.heading}</span>
        <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 transition-transform group-open:rotate-180">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </summary>
      <div className="grid gap-10 border-t border-border p-5 md:grid-cols-2">
        <section aria-labelledby="about" className="flex flex-col gap-3">
          <h2 id="about" className="text-lg font-semibold">
            {d.about}
          </h2>
          {theme.description && (
            <p className="whitespace-pre-line" {...english(lang, theme.english?.description)}>
              {theme.description}
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="font-medium">{d.suits}</dt>
            <dd>{theme.listing.kinds.length > 0 ? theme.listing.kinds.map((k) => w.kinds[k]).join(", ") : d.anyStore}</dd>
            {theme.listing.styles.length > 0 && (
              <>
                <dt className="font-medium">{d.style}</dt>
                <dd>{theme.listing.styles.map((s) => w.styles[s]).join(", ")}</dd>
              </>
            )}
            <dt className="font-medium">{d.sectionStyles}</dt>
            <dd>{theme.sectionStyleNames.map(styleName).join(", ")}</dd>
            {/* Who made it and how many stores use it (D344). */}
            <dt className="font-medium">{d.madeBy}</dt>
            <dd data-theme-author="">{theme.author ?? d.kaizena}</dd>
            <dt className="font-medium">{d.usedBy}</dt>
            <dd>{d.storesN(theme.stores)}</dd>
            {theme.version !== null && (
              <>
                <dt className="font-medium">{d.version}</dt>
                <dd>
                  {theme.version}
                  {theme.updatedAt && `, ${theme.updatedAt.slice(0, 10)}`}
                </dd>
              </>
            )}
          </dl>
        </section>
        <section aria-labelledby="changelog" className="flex flex-col gap-3">
          <h2 id="changelog" className="text-lg font-semibold">
            {d.changelog}
          </h2>
          <ol className="flex flex-col gap-4">
            {theme.changelog.map((entry) => (
              <li key={entry.number}>
                <p className="text-sm font-medium">
                  {d.versionN(entry.number)} <span className="font-normal text-muted">· {entry.date}</span>
                </p>
                {/* What changed is written from the versions in English, and its notes by the theme's makers. */}
                <ul className="list-disc pl-5 text-sm" {...english(lang)}>
                  {entry.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </details>
  );
}
