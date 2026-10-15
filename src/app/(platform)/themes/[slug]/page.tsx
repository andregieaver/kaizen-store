import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JsonLdScript } from "@/components/json-ld";
import { designPreviewPath } from "@/lib/design-presets";
import { siteUrl } from "@/lib/site";
import { STORE_KINDS, THEME_FEATURES, THEME_STYLES, themeJsonLd } from "@/lib/theme-store";
import { themeStoreCards, themeStorePage } from "@/server/theme-store";

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
    alternates: { canonical: `/themes/${theme.slug}` },
    openGraph: { title: `${theme.title} theme`, description, ...(theme.pictureUrl && { images: [{ url: theme.pictureUrl, alt: "" }] }) },
  };
}

/**
 * A theme's page in the theme store (`docs/theme-phase-3.md` step 1): what it is and suits, what it includes (worked out from its
 * published version), its preview on a demo store at computer and phone widths (the public preview, D176, in frames, inert and
 * `noindex`), its changelog, and *Start with this theme*, which opens sign-up with it chosen. Free; no price anywhere.
 */
export default async function ThemePage({ params }: PageProps<"/themes/[slug]">) {
  const theme = await themeStorePage((await params).slug);
  if (!theme) notFound();
  const preview = designPreviewPath(theme.id);
  const url = `${siteUrl()}/themes/${theme.slug}`;
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10">
      <JsonLdScript data={themeJsonLd(theme, url, "Kaizena Flow")} />
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/themes" className="underline underline-offset-2">
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
          <Link href={`/sign-up?theme=${theme.id}`} className="button-primary inline-flex min-h-11 items-center rounded-button px-5 font-medium">
            Start with this theme
          </Link>
          <a href={preview} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-button border border-border px-5 font-medium">
            Open the preview<span className="sr-only"> of {theme.title} (opens in a new window)</span>
          </a>
        </div>
      </div>

      <section aria-labelledby="preview" className="flex flex-col gap-3">
        <h2 id="preview" className="text-xl font-semibold">
          Preview
        </h2>
        <p className="text-sm text-muted">A demo store drawn with {theme.title}. Nothing in it can be pressed.</p>
        <div className="flex flex-col items-start gap-6 lg:flex-row">
          <div className="w-full overflow-hidden rounded-lg border border-border lg:flex-1">
            <iframe src={preview} title={`${theme.title} on a computer`} loading="lazy" className="h-[640px] w-full" />
          </div>
          <div className="mx-auto w-[390px] max-w-full shrink-0 overflow-hidden rounded-[2rem] border-8 border-foreground">
            <iframe src={preview} title={`${theme.title} on a phone`} loading="lazy" className="h-[640px] w-full" />
          </div>
        </div>
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
