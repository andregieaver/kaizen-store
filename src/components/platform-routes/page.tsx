import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { PlatformPageView, platformPageMetadata } from "@/components/platform-page";
import { pageSlugProblem } from "@/lib/page-content";
import { platformPath, type PlatformLang } from "@/lib/platform-lang";
import { PLATFORM_ROLE_COPY } from "@/lib/platform-roles";
import { findEntryPage } from "@/server/content-site";
import { findPublishedPage, listPublishedPages } from "@/server/pages";
import { languageMeta } from "@/server/platform-lang-meta";
import { platformRoleOf } from "@/server/platform-roles";

import { PlatformEntryView, platformEntryMetadata } from "./entry";

type Query = Promise<Record<string, string | string[] | undefined>>;

/**
 * Kaizen's own pages (D42), prerendered when the site is built so their content is plain HTML; pages published later are rendered on first
 * visit and then cached until the next change. `slug` is the page's whole address (`about`, `projects/project-a`), the same in every
 * language of the site (D312).
 */
export async function pageStaticParams(nested: boolean) {
  // Only addresses a page may have: one made before an address was reserved (a language's `/no`) would otherwise take that route's place.
  const pages = (await listPublishedPages()).filter((page) => pageSlugProblem(page.slug) === null);
  if (!nested) {
    const top = pages.filter((page) => !page.slug.includes("/"));
    // Cache Components needs at least one entry; "_" simply renders a 404.
    return top.length > 0 ? top.map((page) => ({ slug: page.slug })) : [{ slug: "_" }];
  }
  const deeper = pages.filter((page) => page.slug.includes("/")).map((page) => {
    const [slug, ...sub] = page.slug.split("/");
    return { slug, sub };
  });
  return deeper.length > 0 ? deeper : [{ slug: "_", sub: ["_"] }];
}

/** The page's whole address from the route's params (`[slug]` and, nested, `[...sub]`). */
export async function slugOf(params: Promise<{ slug: string; sub?: string[] }>): Promise<string> {
  const { slug, sub } = await params;
  return [slug, ...(sub ?? []).map(decodeURIComponent)].join("/");
}

async function load(slug: string) {
  return pageSlugProblem(slug) === null ? findPublishedPage(null, slug) : null;
}

/** With no page at a two-part address, one of Kaizena Flow's own entries (D326) may be there: `/{type}/{entry}`. */
async function loadEntry(slug: string) {
  const parts = slug.split("/");
  return parts.length === 2 && parts.every((part) => part !== "") ? findEntryPage(null, parts[0], parts[1]) : null;
}

export async function pageMetadata(lang: PlatformLang, slug: string): Promise<Metadata> {
  const found = await load(slug);
  if (!found) {
    const entry = await loadEntry(slug);
    return entry ? platformEntryMetadata(lang, entry) : {};
  }
  if ("redirect" in found) return {};
  const path = `/${found.page.slug}`;
  return platformPageMetadata(found.page, path, { lang, languages: (await languageMeta(lang, path)).languages });
}

export async function PageRoute({ lang, slug, searchParams }: { lang: PlatformLang; slug: string; searchParams: Query }) {
  const found = await load(slug);
  if (!found) {
    const entry = await loadEntry(slug);
    if (!entry) notFound();
    return <PlatformEntryView lang={lang} found={entry} />;
  }
  // A page that moved: its old address leads to the new one for good.
  if ("redirect" in found) permanentRedirect(platformPath(lang, `/${found.redirect}`));
  const { page } = found;
  // A page chosen for a place of its own (D143) has the place's address: the front page's `/`, the blog's `/blog`, the theme store's and a
  // theme's page's `/themes` (D285); the 404 page has none.
  const role = await platformRoleOf(page.id);
  if (role) {
    const address = PLATFORM_ROLE_COPY[role].leadsTo;
    if (address) permanentRedirect(platformPath(lang, address));
    notFound();
  }
  return <PlatformPageView page={page} url={`/${page.slug}`} query={searchParams} lang={lang} />;
}
