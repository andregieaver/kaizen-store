import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InstallPreviewView } from "@/components/admin/install-preview-view";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePermission } from "@/server/permissions";
import { installPreview } from "@/server/theme-preview";

export const metadata: Metadata = { title: "Theme preview", robots: { index: false, follow: false } };

/**
 * An installed theme on the store's own pages (D244, `docs/theme-phase-2.md` step 3): one of its published pages or articles, or one of its
 * products, drawn with the theme's settings, section styles, header, footer, product page and CSS in place of the live ones, without writing
 * anything. Served here in the admin rather than on the storefront: it is read per request for the signed-in person (`website:read`), is
 * `noindex`, sets no cookie, and its content is inert, so no visitor and no cached page of the site ever sees it. The pages to look at are
 * links above it (`?page=` an id, `?product=1`). A preview link (D340) draws the same view for someone without a sign-in.
 */
export default async function ThemePreviewPage({ params, searchParams }: PageProps<"/admin/[store]/settings/design/themes/[install]/preview">) {
  const { store: slug, install: installId } = await params;
  const query = await searchParams;
  const { store: base, account } = await requirePermission(slug, "website:read");
  const { common: c, preview: w } = adminText(adminLangOf(account.adminLocale), "design");
  const preview = await installPreview(base.id, installId);
  if (!preview || !base.markets[0]) notFound();
  const here = `/admin/${base.slug}/settings/design/themes/${preview.install.id}/preview`;
  return (
    <InstallPreviewView
      base={base}
      preview={preview}
      pageId={typeof query.page === "string" ? query.page : null}
      wantsProduct={query.product === "1"}
      here={here}
      words={w}
      banner={({ page, product }) => (
        <>
          <span className="font-medium">
            {fillWords(w.banner, { name: preview.install.title, live: preview.install.live ? w.yourLive : "", shown: product ? w.aProductShown : page ? fillWords(c.quote, { title: page.title }) : w.noPageShown })}
          </span>
          <Link href={`/admin/${base.slug}/settings/design${preview.install.live ? "" : `/themes/${preview.install.id}`}`} className="underline">
            {w.back}
          </Link>
        </>
      )}
    />
  );
}
