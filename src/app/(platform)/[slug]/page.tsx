import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { PlatformPageView, platformPageMetadata } from "@/components/platform-page";
import { pageSlugProblem } from "@/lib/page-content";
import { PLATFORM_ROLE_COPY } from "@/lib/platform-roles";
import { findPublishedPage, listPublishedPages } from "@/server/pages";
import { platformRoleOf } from "@/server/platform-roles";

type Props = PageProps<"/[slug]">;

/**
 * Kaizen's own pages (D42), prerendered when the site is built so their
 * content is plain HTML; pages published later are rendered on first visit
 * and then cached until the next change.
 */
export async function generateStaticParams() {
  const pages = await listPublishedPages();
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return pages.length > 0 ? pages.map((page) => ({ slug: page.slug })) : [{ slug: "_" }];
}

async function load(params: Props["params"]) {
  const { slug } = await params;
  return pageSlugProblem(slug) === null ? findPublishedPage(null, slug) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await load(params);
  if (!found || "redirect" in found) return {};
  return platformPageMetadata(found.page, `/${found.page.slug}`);
}

export default async function PlatformPage({ params }: Props) {
  const found = await load(params);
  if (!found) notFound();
  // A page that moved: its old address leads to the new one for good.
  if ("redirect" in found) permanentRedirect(`/${found.redirect}`);
  const { page } = found;
  // A page chosen for a place of its own (D143) has the place's address: the front page's `/`, the blog's `/blog`; the 404 page has none.
  const role = await platformRoleOf(page.id);
  if (role) {
    const address = PLATFORM_ROLE_COPY[role].address;
    if (address) permanentRedirect(address);
    notFound();
  }
  return <PlatformPageView page={page} url={`/${page.slug}`} />;
}
