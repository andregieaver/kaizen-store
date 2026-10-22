import type { Metadata } from "next";

import { HomeRoute, homeMetadata } from "@/components/platform-routes/home";

export function generateMetadata(): Promise<Metadata> {
  return homeMetadata("nb");
}

export default function NorwegianHome({ searchParams }: PageProps<"/no">) {
  return <HomeRoute lang="nb" searchParams={searchParams} />;
}
