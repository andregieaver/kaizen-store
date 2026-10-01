import type { Metadata } from "next";
import { connection } from "next/server";

import { SectionHub } from "@/components/admin/section-hub";
import { STORE_SECTIONS, storeSections } from "@/lib/store-nav";
import { requireMember } from "@/server/auth";

export const metadata: Metadata = { title: "Website" };

/** The store's website (D147): its pages, blog, media, menus, header, footer, look and translations, as cards. */
export default async function StoreWebsitePage({ params }: PageProps<"/admin/[store]/website">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const { store } = await requireMember((await params).store);
  const section = storeSections(store).find((s) => s.key === "website") ?? STORE_SECTIONS.find((s) => s.key === "website")!;
  return <SectionHub title={section.label} intro={section.intro} groups={section.groups} base={`/admin/${store.slug}`} />;
}
