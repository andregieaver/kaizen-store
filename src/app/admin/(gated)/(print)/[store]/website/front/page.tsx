import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { InstallPreviewView } from "@/components/admin/install-preview-view";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePermission } from "@/server/permissions";
import { installPreview } from "@/server/theme-preview";
import { col, typedRow } from "@/server/typed-rows";

export const metadata: Metadata = { title: "Front page", robots: { index: false, follow: false } };

const LIVE_ROW = z.object({ id: col.uuid });

/**
 * Round 3 (D603): the store's front page with its live theme, alone on the page, for the picture on the Website hub. It is the theme
 * preview's view (D244) of the live install without its bar: read per request for the signed-in person (`website:read`), `noindex`,
 * inert, and in the admin's own origin, so the hub can frame it whatever domain the shop is on.
 */
export default async function FrontPagePicture({ params }: PageProps<"/admin/[store]/website/front">) {
  const { store: slug } = await params;
  const { store, account } = await requirePermission(slug, "website:read");
  const live = await typedRow(LIVE_ROW, sql`select id from commerce.store_theme_installs where store_id = ${store.id}::uuid and live limit 1`);
  const preview = live ? await installPreview(store.id, live.id) : null;
  if (!preview || !store.frontPageId || !store.markets[0]) notFound();
  const w = adminText(adminLangOf(account.adminLocale), "design").preview;
  return (
    <InstallPreviewView
      base={store}
      preview={preview}
      pageId={store.frontPageId}
      wantsProduct={false}
      here={`/admin/${store.slug}/website/front`}
      words={w}
      banner={() => null}
      bare
    />
  );
}
