import type { Metadata } from "next";

import { CookiesRoute, cookiesMetadata } from "@/components/platform-routes/cookies";

export function generateMetadata(): Promise<Metadata> {
  return cookiesMetadata("en");
}

export default function CookiesPage() {
  return <CookiesRoute lang="en" />;
}
