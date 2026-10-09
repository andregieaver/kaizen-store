import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { PlatformPageView, platformPageMetadata } from "@/components/platform-page";
import { pageSlugProblem } from "@/lib/page-content";
import { PLATFORM_ROLE_COPY } from "@/lib/platform-roles";
import { findPublishedPage, listPublishedPages } from "@/server/pages";
import { platformRoleOf } from "@/server/platform-roles";

type Props = {
  params: Promise<{ slug: string; sub: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Kaizen's pages nested under another (`/projects/project-a`), drawn like any other (`[slug]/page.tsx`). */
export async function generateStaticParams() {
  const pages = await listPublishedPages();
  const nested = pages.filter((page) => page.slug.includes("/")).map((page) => {
    const [slug, ...sub] = page.slug.split("/");
    return { slug, sub };
  });
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return nested.length > 0 ? nested : [{ slug: "_", sub: ["_"] }];
}

async function load(params: Props["params"]) {
  const { slug: first, sub } = await params;
  const slug = [first, ...sub.map(decodeURIComponent)].join("/");
  return pageSlugProblem(slug) === null ? findPublishedPage(null, slug) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await load(params);
  if (!found || "redirect" in found) return {};
  return platformPageMetadata(found.page, `/${found.page.slug}`);
}

export default async function NestedPlatformPage({ params, searchParams }: Props) {
  const found = await load(params);
  if (!found) notFound();
  if ("redirect" in found) permanentRedirect(`/${found.redirect}`);
  const { page } = found;
  const role = await platformRoleOf(page.id);
  if (role) {
    const address = PLATFORM_ROLE_COPY[role].address;
    if (address) permanentRedirect(address);
    notFound();
  }
  return <PlatformPageView page={page} url={`/${page.slug}`} query={searchParams} />;
}
