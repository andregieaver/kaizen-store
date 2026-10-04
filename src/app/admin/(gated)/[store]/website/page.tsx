import type { Metadata } from "next";
import { connection } from "next/server";

import { SectionHub } from "@/components/admin/section-hub";
import { canOpenPath } from "@/lib/permissions";
import { STORE_SECTIONS, storeSections } from "@/lib/store-nav";
import { holderOf } from "@/server/auth";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Website" };

/** The store's website (D147): its pages, blog, media, menus, header, footer, look and translations, as cards. */
export default async function StoreWebsitePage({ params }: PageProps<"/admin/[store]/website">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const member = await requirePermission((await params).store, "website:read");
  const { store } = member;
  // The cards of a member's own role only (wave 1, 1f): a card for a page they cannot open would be a link to a 404.
  const holder = holderOf(member);
  const section = storeSections(store, (path) => canOpenPath(holder, path)).find((s) => s.key === "website") ?? STORE_SECTIONS.find((s) => s.key === "website")!;
  return <SectionHub title={section.label} intro={section.intro} groups={section.groups} base={`/admin/${store.slug}`} />;
}
