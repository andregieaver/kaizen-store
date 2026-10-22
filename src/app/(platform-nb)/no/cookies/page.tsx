import type { Metadata } from "next";

import { CookiesRoute, cookiesMetadata } from "@/components/platform-routes/cookies";

export function generateMetadata(): Promise<Metadata> {
  return cookiesMetadata("nb");
}

export default function NorwegianCookies() {
  return <CookiesRoute lang="nb" />;
}
