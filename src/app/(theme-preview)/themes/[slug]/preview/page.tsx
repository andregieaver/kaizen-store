import type { Metadata } from "next";

import { ThemeFullPreview, themePreviewMetadata } from "@/components/platform-routes/theme-preview";

export async function generateMetadata({ params }: PageProps<"/themes/[slug]/preview">): Promise<Metadata> {
  return themePreviewMetadata("en", (await params).slug);
}

export default function ThemePreviewPage({ params, searchParams }: PageProps<"/themes/[slug]/preview">) {
  return <ThemeFullPreview lang="en" params={params} searchParams={searchParams} />;
}
