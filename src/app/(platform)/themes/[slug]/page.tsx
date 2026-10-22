import type { Metadata } from "next";

import { ThemeRoute, themeMetadata, themeStaticParams } from "@/components/platform-routes/themes";

export function generateStaticParams() {
  return themeStaticParams();
}

export async function generateMetadata({ params }: PageProps<"/themes/[slug]">): Promise<Metadata> {
  return themeMetadata("en", (await params).slug);
}

export default async function ThemePage({ params }: PageProps<"/themes/[slug]">) {
  return <ThemeRoute lang="en" slug={(await params).slug} />;
}
