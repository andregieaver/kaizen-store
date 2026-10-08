import type { Metadata } from "next";

import { PlatformPageView, platformPageMetadata } from "@/components/platform-page";
import { platformPageForRole } from "@/server/platform-roles";

import { BlogIndex } from "../term-listing";

/** Kaizen's own blog page's search and sharing texts where one is chosen (D143). */
export async function generateMetadata(): Promise<Metadata> {
  const page = await platformPageForRole("blog");
  if (page) return platformPageMetadata(page, "/blog");
  return {
    title: "Blog",
    description: "News and guides from Kaizen: selling online across the EU, and how the platform works.",
    alternates: { canonical: "/blog" },
  };
}

/** Kaizen's blog (D57): one of its own pages where one is chosen (D143), else its articles, newest first. */
export default async function BlogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await platformPageForRole("blog");
  if (page) return <PlatformPageView page={page} url="/blog" query={searchParams} />;
  return <BlogIndex />;
}
