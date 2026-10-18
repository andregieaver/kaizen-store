import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { JsonLdScript } from "@/components/json-ld";
import { SeeItLive } from "@/components/see-it-live";
import { ThemePreviewStage, type StageLook } from "@/components/theme-preview-stage";
import { designPreviewPath } from "@/lib/design-presets";
import { siteUrl } from "@/lib/site";
import { STORE_KINDS, THEME_FEATURES, THEME_STYLES, sharePicture, shownLooks, themeJsonLd, themePreviewPath, themeStartLink, themeTryLink } from "@/lib/theme-store";
import { liveDemosOf } from "@/server/demo-stores";
import { themeStoreCards, themeStorePage } from "@/server/theme-store";
import { platformHref, themeStorePath, themeStoreUrl, themesHost } from "@/lib/theme-host";

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
export default async function ThemePage({ params }: PageProps<"/themes/[slug]">) {
  const { slug } = await params;
  const theme = await themeStorePage(slug);
  if (!theme) {
    // On the theme store's own host every one-part address comes here: one that is no theme is Kaizena Flow's own (the header's
    // `/pricing`, `/sign-up`), so it goes there (`docs/theme-phase-3.md` step 3). Without the host, `/themes/{slug}` has nothing else.
    if (themesHost()) redirect(`${siteUrl()}/${slug}`);
    notFound();
  }
  // Kaizena Flow's own site serves the live preview, sign-up and the try route: full addresses while the theme store has its own host. Every
  // look is shown on the theme's own content once it is published (D275), never on the Standard store (D274); until then its colours.
  const shown = new Set(shownLooks(theme.looks).map((look) => look.key));
  const looks: StageLook[] = theme.looks.map((look) => {
    const preview = shown.has(look.key);
    const starter = look.showcase?.starterId ?? null;
    return {
      key: look.key,
      name: look.name,
      swatch: look.swatch ?? theme.swatch,
      frameHref: preview ? platformHref(designPreviewPath(theme.id, starter, false, false, true, look.key)) : null,
      previewHref: preview ? themePreviewPath(theme.slug, look.key) : null,
      tryHref: platformHref(themeTryLink(theme.slug, look.key)),
      startHref: platformHref(themeStartLink(theme.id, look.key)),
      computerPoster: look.shots?.computer?.screen?.url ?? null,
      phonePoster: look.shots?.phone?.screen?.url ?? null,
    };
  });
  // Its own pictures, chosen by a person (D250); the frames already show what it looks like.
  const own = [theme.pictureUrl, ...theme.listing.pictures].filter((url): url is string => Boolean(url));
  const highlights = theme.highlights ?? [];
  const url = themeStoreUrl(theme.slug);
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-14 px-4 py-8">
      <JsonLdScript data={themeJsonLd({ ...theme, pictureUrl: sharePicture(theme) }, url, "Kaizena Flow")} />
      <div className="flex flex-col gap-6">
        <nav aria-label="Breadcrumb" className="text-sm">
          <Link href={themeStorePath()} className="underline underline-offset-2">
            Themes
          </Link>
        </nav>
        <ThemePreviewStage
          title={theme.title}
          looks={looks}
          heading={
            <>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{theme.title}</h1>
              {theme.summary && <p className="text-lg text-muted">{theme.summary}</p>}
              <p className="text-sm text-muted">
                Free{theme.presets.length > 0 ? ` · ${theme.presets.length + 1} presets` : ""}
              </p>
            </>
          }
        />
      </div>

      {/* The demo stores wearing one of its looks (D277), read every few minutes: the page itself stays prerendered. */}
      <Suspense fallback={null}>
        <LiveDemos presetId={theme.id} title={theme.title} looks={looks} />
      </Suspense>

      {/* Pictures composed from its photographs, with words a person wrote or accepted (`docs/theme-showcase-phase-2.md` step 2). */}
      {highlights.length > 0 && (
        <section aria-labelledby="highlights" className="flex flex-col gap-6">
          <h2 id="highlights" className="text-2xl font-semibold tracking-tight">
            Highlights
          </h2>
          <ul className="grid gap-8 md:grid-cols-3" data-highlights="">
            {highlights.map((highlight) => (
              <li key={highlight.kind}>
                <figure className="flex flex-col gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- made pictures, in Kaizena Flow's own bucket */}
                  <img src={highlight.url} alt={highlight.alt} width={highlight.width} height={highlight.height} loading="lazy" className="w-full rounded-lg" />
                  {highlight.title && (
                    <figcaption className="flex flex-col gap-1">
                      <span className="font-medium">{highlight.title}</span>
                      {highlight.text && <span className="text-sm text-muted">{highlight.text}</span>}
                    </figcaption>
                  )}
                </figure>
              </li>
            ))}
          </ul>
        </section>
      )}

      {own.length > 0 && (
        <section aria-labelledby="pictures" className="flex flex-col gap-4">
          <h2 id="pictures" className="sr-only">
            Pictures
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {own.map((picture, index) => (
              <li key={picture}>
                {/* eslint-disable-next-line @next/next/no-img-element -- the theme's own pictures, from Kaizena Flow's media library */}
                <img src={picture} alt={`${theme.title}, picture ${index + 1}`} loading="lazy" className="aspect-video w-full rounded-lg border border-border object-cover" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="what-you-get" className="flex flex-col gap-4">
        <h2 id="what-you-get" className="text-2xl font-semibold tracking-tight">
          What you get
        </h2>
        <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {theme.features.map((feature) => (
            <li key={feature} className="flex gap-2">
              <span aria-hidden="true">✓</span>
              <span>{THEME_FEATURES[feature]}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted">Your words, pictures and products stay as they are when you switch.</p>
      </section>

      {/* For Lisa: one deliberate step away (CLAUDE.md, Homer and Lisa). */}
      <details className="group rounded-lg border border-border">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 font-medium marker:hidden [&::-webkit-details-marker]:hidden">
          Details
          <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 transition-transform group-open:rotate-180">
            <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </summary>
        <div className="grid gap-10 border-t border-border p-5 md:grid-cols-2">
          <section aria-labelledby="about" className="flex flex-col gap-3">
            <h2 id="about" className="text-lg font-semibold">
              About this theme
            </h2>
            {theme.description && <p className="whitespace-pre-line">{theme.description}</p>}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="font-medium">Suits</dt>
              <dd>{theme.listing.kinds.length > 0 ? theme.listing.kinds.map((k) => STORE_KINDS[k]).join(", ") : "Any kind of store"}</dd>
              {theme.listing.styles.length > 0 && (
                <>
                  <dt className="font-medium">Style</dt>
                  <dd>{theme.listing.styles.map((s) => THEME_STYLES[s]).join(", ")}</dd>
                </>
              )}
              <dt className="font-medium">Section styles</dt>
              <dd>{theme.sectionStyles.join(", ")}</dd>
              {theme.version !== null && (
                <>
                  <dt className="font-medium">Version</dt>
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
              Changelog
            </h2>
            <ol className="flex flex-col gap-4">
              {theme.changelog.map((entry) => (
                <li key={entry.number}>
                  <p className="text-sm font-medium">
                    Version {entry.number} <span className="font-normal text-muted">· {entry.date}</span>
                  </p>
                  <ul className="list-disc pl-5 text-sm">
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
    </main>
  );
}

/** *See it live* (D277): the published demo stores wearing one of the theme's looks; nothing when there is none. */
async function LiveDemos({ presetId, title, looks }: { presetId: string; title: string; looks: StageLook[] }) {
  const demos = await liveDemosOf(presetId);
  return <SeeItLive title={title} demos={demos} looks={looks} />;
}
