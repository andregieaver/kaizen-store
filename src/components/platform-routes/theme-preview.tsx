import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { SwatchDot } from "@/components/theme-swatch";
import { designPreviewPath } from "@/lib/design-presets";
import type { PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { lookChoice, previewView, shownLooks, themePagePath, themePreviewPath, themeStartLink, type PreviewView } from "@/lib/theme-store";
import { platformHref } from "@/lib/theme-host";
import { themePreviewNeighbours, themeStorePage } from "@/server/theme-store";

type Params = Promise<{ slug: string }>;
type Query = Promise<Record<string, string | string[] | undefined>>;

export async function themePreviewMetadata(lang: PlatformLang, slug: string): Promise<Metadata> {
  const w = platformText(lang).themeStore.meta;
  const theme = await themeStorePage(slug);
  return { title: theme ? w.previewTitle(theme.title) : w.notFound };
}

/**
 * A theme's full-screen preview in the theme store (D275, `docs/themes-content-and-demo-stores.md` section 6): a slim bar (back to the
 * theme, the previous and next theme (D285), its presets, Home or A product, computer or phone, *Use this theme*) over the chosen look on
 * the theme's own content, which can be scrolled but not pressed (the public preview, inert, in a frame). Every choice is a link that keeps
 * the others (the next theme opens on its own look, on the same page and screen), so it works without JavaScript and a shared address opens
 * on the same view. In `lang` (D312 P3): the bar's words and every link stay in it; the store in the frame is the demo store's own.
 */
export function ThemeFullPreview({ lang, params, searchParams }: { lang: PlatformLang; params: Params; searchParams: Query }) {
  return (
    <Suspense fallback={null}>
      <FullPreview lang={lang} params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const segment = "flex min-h-9 items-center rounded-full px-3 text-sm aria-[current=page]:bg-foreground aria-[current=page]:text-background";

async function FullPreview({ lang, params, searchParams }: { lang: PlatformLang; params: Params; searchParams: Query }) {
  const w = platformText(lang).themeStore;
  const { slug } = await params;
  const [theme, around] = await Promise.all([themeStorePage(slug), themePreviewNeighbours(slug)]);
  if (!theme) notFound();
  const looks = shownLooks(theme.looks);
  // A theme with no published content has nothing to preview (D274, D275): its page shows its colours.
  if (looks.length === 0) redirect(themePagePath(theme.slug, null, lang));
  const query = await searchParams;
  const key = lookChoice(looks, query.preset);
  const view = previewView(query);
  const look = looks.find((l) => l.key === key) ?? looks[0];
  const name = look.key ? `${theme.title} · ${look.name}` : theme.title;
  const src = platformHref(designPreviewPath(theme.id, look.showcase?.starterId ?? null, false, false, true, look.key, view.show));
  const here = (change: Partial<PreviewView & { preset: string | null }>) =>
    themePreviewPath(theme.slug, change.preset !== undefined ? change.preset : key, { ...view, ...change }, lang);

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-background px-3 py-2">
        <Link href={themePagePath(theme.slug, key, lang)} className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-sm font-medium hover:underline">
          <span aria-hidden="true">←</span> {theme.title}
        </Link>
        {around && (
          <nav aria-label={w.preview.otherThemes} className="flex items-center gap-1 rounded-full border border-border p-0.5">
            <Link href={themePreviewPath(around.previous.slug, null, view, lang)} rel="prev" title={around.previous.title} className={segment}>
              <span aria-hidden="true">‹</span>
              <span className="ml-1">{w.preview.previous}</span>
              <span className="sr-only">{w.preview.theme(around.previous.title)}</span>
            </Link>
            <Link href={themePreviewPath(around.next.slug, null, view, lang)} rel="next" title={around.next.title} className={segment}>
              <span className="mr-1">{w.preview.next}</span>
              <span className="sr-only">{w.preview.theme(around.next.title)}</span>
              <span aria-hidden="true">›</span>
            </Link>
          </nav>
        )}
        {looks.length > 1 && (
          <ul aria-label={w.stage.presets} className="flex items-center gap-1">
            {looks.map((choice) => (
              <li key={choice.key ?? ""}>
                <Link
                  href={here({ preset: choice.key })}
                  replace
                  aria-current={choice.key === look.key ? "page" : undefined}
                  title={choice.name}
                  className="flex size-9 items-center justify-center rounded-full aria-[current=page]:ring-2 aria-[current=page]:ring-foreground"
                >
                  <SwatchDot swatch={choice.swatch ?? theme.swatch} />
                  <span className="sr-only">{choice.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <nav aria-label={w.preview.page} className="flex items-center gap-1 rounded-full border border-border p-0.5">
          <Link href={here({ show: "home" })} replace aria-current={view.show === "home" ? "page" : undefined} className={segment}>
            {w.preview.home}
          </Link>
          <Link href={here({ show: "product" })} replace aria-current={view.show === "product" ? "page" : undefined} className={segment}>
            {w.preview.product}
          </Link>
        </nav>
        {/* On a phone the store is drawn at the phone's own width either way. */}
        <nav aria-label={w.preview.screen} className="hidden items-center gap-1 rounded-full border border-border p-0.5 md:flex">
          <Link href={here({ device: "computer" })} replace aria-current={view.device === "computer" ? "page" : undefined} className={segment}>
            {w.preview.computer}
          </Link>
          <Link href={here({ device: "phone" })} replace aria-current={view.device === "phone" ? "page" : undefined} className={segment}>
            {w.preview.phone}
          </Link>
        </nav>
        <a href={platformHref(themeStartLink(theme.id, look.key, lang))} className="button-primary ml-auto inline-flex min-h-9 items-center rounded-button px-5 text-sm font-medium">
          {w.stage.use}
          <span className="sr-only">{look.key ? `: ${name}` : ""}</span>
        </a>
      </header>
      <main id="main" className="min-h-0 flex-1">
        {view.device === "phone" ? (
          <div className="flex h-full justify-center overflow-hidden bg-foreground/5 px-4 py-6">
            <div className="h-full w-[390px] max-w-full overflow-hidden rounded-[2rem] border-8 border-foreground bg-background shadow-lg">
              <iframe key={src} src={src} title={w.stage.onPhone.replaceAll("{name}", name)} className="h-full w-full border-0" />
            </div>
          </div>
        ) : (
          <iframe key={src} src={src} title={w.stage.onComputer.replaceAll("{name}", name)} className="h-full w-full border-0" />
        )}
      </main>
    </>
  );
}
