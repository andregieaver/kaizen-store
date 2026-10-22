import type { Metadata } from "next";

import { ThemesRoute, themesMetadata } from "@/components/platform-routes/themes";

export function generateMetadata(): Promise<Metadata> {
  return themesMetadata("nb");
}

export default function NorwegianThemes({ searchParams }: PageProps<"/no/themes">) {
  return <ThemesRoute lang="nb" searchParams={searchParams} />;
}
