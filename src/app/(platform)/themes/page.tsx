import type { Metadata } from "next";

import { ThemesRoute, themesMetadata } from "@/components/platform-routes/themes";

export function generateMetadata(): Promise<Metadata> {
  return themesMetadata("en");
}

export default function ThemesPage({ searchParams }: PageProps<"/themes">) {
  return <ThemesRoute lang="en" searchParams={searchParams} />;
}
