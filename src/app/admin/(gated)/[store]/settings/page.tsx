import type { Metadata } from "next";
import { connection } from "next/server";

import { SectionHub } from "@/components/admin/section-hub";
import { canOpenPath } from "@/lib/permissions";
import { STORE_SECTIONS, storeSections } from "@/lib/store-nav";
import { holderOf } from "@/server/auth";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Settings" };

/** The store's settings (D147): its company, markets, payments, delivery, tools and team, as cards under headings. */
export default async function StoreSettingsPage({ params }: PageProps<"/admin/[store]/settings">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  // The cards of a member's own role only (wave 1, 1f): a card for a page they cannot open would be a link to a 404.
  const holder = holderOf(member);
  const section = storeSections(store, (path) => canOpenPath(holder, path)).find((s) => s.key === "settings") ?? STORE_SECTIONS.find((s) => s.key === "settings")!;
  return <SectionHub title={section.label} intro={section.intro} groups={section.groups} base={`/admin/${store.slug}`} />;
}
