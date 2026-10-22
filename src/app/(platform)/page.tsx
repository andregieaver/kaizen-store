import type { Metadata } from "next";

import { HomeRoute, homeMetadata } from "@/components/platform-routes/home";

export function generateMetadata(): Promise<Metadata> {
  return homeMetadata("en");
}

/** The platform's front page in English (`HomeRoute`, D143, D312). */
export default function Home({ searchParams }: PageProps<"/">) {
  return <HomeRoute lang="en" searchParams={searchParams} />;
}
