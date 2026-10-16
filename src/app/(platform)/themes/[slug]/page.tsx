import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { JsonLdScript } from "@/components/json-ld";
import { ThemePreviewStage, type StageLook } from "@/components/theme-preview-stage";
import { designPreviewPath } from "@/lib/design-presets";
import { siteUrl } from "@/lib/site";
import { STORE_KINDS, THEME_FEATURES, THEME_STYLES, themeJsonLd, themeTryLink } from "@/lib/theme-store";
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
    // Its own picture, else one drawn from its colours (`/themes/{slug}/og.png`, on Kaizena Flow's host, by full address).
    openGraph: { title: `${theme.title} theme`, description, images: [{ url: theme.pictureUrl ?? `${siteUrl()}/themes/${theme.slug}/og.png`, alt: "" }] },
  };
}

/**
 * A theme's page in the theme store (`docs/theme-phase-3.md` step 1): what it is and suits, what it includes (worked out from its
 * published version), its preview on a demo store at computer and phone widths (the public preview, D176, in frames, inert and
 * `noindex`), its changelog, and *Start with this theme*, which opens sign-up with it chosen. Free; no price anywhere.
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
  // Kaizena Flow's own site serves the preview, sign-up and the try route: full addresses while the theme store has its own host. Each
  // look is previewed on the demo store of its trade where it has one (`docs/theme-showcase-phase-1.md` step 3); the frames show the store
  // alone, since this page already says what it is.
  const looks: StageLook[] = theme.looks.map((look) => {
    const starter = look.showcase?.starterId ?? null;
    return {
      key: look.key,
      name: look.name,
      trade: look.showcase?.trade ?? null,
      line: look.showcase?.line ?? null,
      frameHref: platformHref(designPreviewPath(theme.id, starter, false, false, true, look.key)),
      previewHref: platformHref(designPreviewPath(theme.id, starter, false, false, false, look.key)),
      tryHref: platformHref(themeTryLink(theme.slug, look.key)),
    };
  });
  const preview = looks[0].previewHref;
  const url = themeStoreUrl(theme.slug);
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10">
      <JsonLdScript data={themeJsonLd(theme, url, "Kaizena Flow")} />
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={themeStorePath()} className="underline underline-offset-2">
          Themes
        </Link>
      </nav>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{theme.title}</h1>
          {theme.summary && <p className="text-lg text-muted">{theme.summary}</p>}
          <p className="text-sm">
            <span className="font-medium">Free</span>
            {theme.version !== null && <span className="text-muted"> · version {theme.version}{theme.updatedAt && `, ${theme.updatedAt.slice(0, 10)}`}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href={platformHref(`/sign-up?theme=${theme.id}`)} className="button-primary inline-flex min-h-11 items-center rounded-button px-5 font-medium">
            Start with this theme
          </a>
          {/* A route that knows who is signed in, then the admin (another root layout): a plain link (`docs/theme-phase-3.md` step 2). */}
          <a href={platformHref(themeTryLink(theme.slug))} className="inline-flex min-h-11 items-center rounded-button border border-border px-5 font-medium">
            Try it in your store
          </a>
          <a href={preview} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-button border border-border px-5 font-medium">
            Open the preview<span className="sr-only"> of {theme.title} (opens in a new window)</span>
          </a>
        </div>
      </div>

      {(theme.pictureUrl || theme.listing.pictures.length > 0) && (
        <section aria-labelledby="pictures" className="flex flex-col gap-3">
          <h2 id="pictures" className="sr-only">
            Pictures
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[theme.pictureUrl, ...theme.listing.pictures].filter((url): url is string => Boolean(url)).map((url, index) => (
              <li key={url}>
                {/* eslint-disable-next-line @next/next/no-img-element -- the theme's own pictures, from Kaizena Flow's media library */}
                <img src={url} alt={`${theme.title}, picture ${index + 1}`} loading={index < 3 ? "eager" : "lazy"} className="aspect-video w-full rounded-lg border border-border object-cover" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="preview" className="flex flex-col gap-3">
        <h2 id="preview" className="text-xl font-semibold">
          Preview
        </h2>
        <p className="text-sm text-muted">A demo store drawn with {theme.title}. Nothing in it can be pressed.</p>
        <ThemePreviewStage title={theme.title} looks={looks} />
      </section>

      <div className="grid gap-10 md:grid-cols-2">
        <section aria-labelledby="about" className="flex flex-col gap-3">
          <h2 id="about" className="text-xl font-semibold">
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
          </dl>
          <h3 className="mt-2 font-medium">What it includes</h3>
          <ul className="list-disc pl-5 text-sm">
            {theme.features.map((feature) => (
              <li key={feature}>{THEME_FEATURES[feature]}</li>
            ))}
            <li>Your words, pictures, products and menus stay as they are when you switch</li>
          </ul>
        </section>
        <section aria-labelledby="changelog" className="flex flex-col gap-3">
          <h2 id="changelog" className="text-xl font-semibold">
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
    </main>
  );
}
