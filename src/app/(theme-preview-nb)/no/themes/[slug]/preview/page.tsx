import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ThemeFullPreview, themePreviewMetadata } from "@/components/platform-routes/theme-preview";
import { offersLang } from "@/server/platform-lang-meta";

export async function generateMetadata({ params }: PageProps<"/no/themes/[slug]/preview">): Promise<Metadata> {
  return themePreviewMetadata("nb", (await params).slug);
}

/** The full-screen preview in Norwegian (D312 P3), only while the site is offered in it, as every Norwegian page. */
export default async function NorwegianThemePreview({ params, searchParams }: PageProps<"/no/themes/[slug]/preview">) {
  if (!(await offersLang("nb"))) notFound();
  return <ThemeFullPreview lang="nb" params={params} searchParams={searchParams} />;
}
