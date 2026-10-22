import type { Metadata } from "next";

import { ThemeRoute, themeMetadata, themeStaticParams } from "@/components/platform-routes/themes";

export function generateStaticParams() {
  return themeStaticParams();
}

export async function generateMetadata({ params }: PageProps<"/no/themes/[slug]">): Promise<Metadata> {
  return themeMetadata("nb", (await params).slug);
}

export default async function NorwegianTheme({ params }: PageProps<"/no/themes/[slug]">) {
  return <ThemeRoute lang="nb" slug={(await params).slug} />;
}
