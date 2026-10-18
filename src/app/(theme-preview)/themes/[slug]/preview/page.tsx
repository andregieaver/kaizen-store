import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { SwatchDot } from "@/components/theme-swatch";
import { designPreviewPath } from "@/lib/design-presets";
import { lookChoice, previewView, shownLooks, themePagePath, themePreviewPath, themeStartLink, type PreviewView } from "@/lib/theme-store";
import { platformHref } from "@/lib/theme-host";
import { themeStorePage } from "@/server/theme-store";

export async function generateMetadata({ params }: PageProps<"/themes/[slug]/preview">): Promise<Metadata> {
  const theme = await themeStorePage((await params).slug);
  return { title: theme ? `${theme.title} theme, full preview` : "Theme not found" };
}

/**
 * A theme's full-screen preview in the theme store (D275, `docs/themes-content-and-demo-stores.md` section 6): a slim bar (back to the
 * theme, its presets, Home or A product, computer or phone, *Use this theme*) over the chosen look on the theme's own content, which can be
 * scrolled but not pressed (the public preview, inert, in a frame). Every choice is a link that keeps the others, so it works without
 * JavaScript and a shared address opens on the same view.
 */
export default function ThemeFullPreview({ params, searchParams }: PageProps<"/themes/[slug]/preview">) {
  return (
    <Suspense fallback={null}>
      <FullPreview params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const segment = "flex min-h-9 items-center rounded-full px-3 text-sm aria-[current=page]:bg-foreground aria-[current=page]:text-background";

async function FullPreview({ params, searchParams }: Pick<PageProps<"/themes/[slug]/preview">, "params" | "searchParams">) {
  const { slug } = await params;
  const theme = await themeStorePage(slug);
  if (!theme) notFound();
  const looks = shownLooks(theme.looks);
  // A theme with no published content has nothing to preview (D274, D275): its page shows its colours.
  if (looks.length === 0) redirect(themePagePath(theme.slug));
  const query = await searchParams;
  const key = lookChoice(looks, query.preset);
  const view = previewView(query);
  const look = looks.find((l) => l.key === key) ?? looks[0];
  const name = look.key ? `${theme.title} · ${look.name}` : theme.title;
  const src = platformHref(designPreviewPath(theme.id, look.showcase?.starterId ?? null, false, false, true, look.key, view.show));
  const here = (change: Partial<PreviewView & { preset: string | null }>) =>
    themePreviewPath(theme.slug, change.preset !== undefined ? change.preset : key, { ...view, ...change });

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-background px-3 py-2">
        <Link href={themePagePath(theme.slug, key)} className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-sm font-medium hover:underline">
          <span aria-hidden="true">←</span> {theme.title}
        </Link>
        {looks.length > 1 && (
          <ul aria-label="Presets" className="flex items-center gap-1">
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
        <nav aria-label="Page" className="flex items-center gap-1 rounded-full border border-border p-0.5">
          <Link href={here({ show: "home" })} replace aria-current={view.show === "home" ? "page" : undefined} className={segment}>
            Home
          </Link>
          <Link href={here({ show: "product" })} replace aria-current={view.show === "product" ? "page" : undefined} className={segment}>
            A product
          </Link>
        </nav>
        {/* On a phone the store is drawn at the phone's own width either way. */}
        <nav aria-label="Screen" className="hidden items-center gap-1 rounded-full border border-border p-0.5 md:flex">
          <Link href={here({ device: "computer" })} replace aria-current={view.device === "computer" ? "page" : undefined} className={segment}>
            Computer
          </Link>
          <Link href={here({ device: "phone" })} replace aria-current={view.device === "phone" ? "page" : undefined} className={segment}>
            Phone
          </Link>
        </nav>
        <a href={platformHref(themeStartLink(theme.id, look.key))} className="button-primary ml-auto inline-flex min-h-9 items-center rounded-button px-5 text-sm font-medium">
          Use this theme<span className="sr-only">{look.key ? `: ${name}` : ""}</span>
        </a>
      </header>
      <main id="main" className="min-h-0 flex-1">
        {view.device === "phone" ? (
          <div className="flex h-full justify-center overflow-hidden bg-foreground/5 px-4 py-6">
            <div className="h-full w-[390px] max-w-full overflow-hidden rounded-[2rem] border-8 border-foreground bg-background shadow-lg">
              <iframe key={src} src={src} title={`${name} on a phone`} className="h-full w-full border-0" />
            </div>
          </div>
        ) : (
          <iframe key={src} src={src} title={`${name} on a computer`} className="h-full w-full border-0" />
        )}
      </main>
    </>
  );
}
