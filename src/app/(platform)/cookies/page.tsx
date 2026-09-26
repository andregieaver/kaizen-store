import type { Metadata } from "next";

import { CookiePolicy } from "@/components/consent/cookie-policy";
import { getPlatformChrome } from "@/server/platform-navigation";
import { siteCookies } from "@/server/site-cookies";

export const metadata: Metadata = {
  title: "Cookies",
  description: "The cookies Kaizen's site uses, who sets them, why and for how long.",
  alternates: { canonical: "/cookies" },
};

/** Kaizen's cookie page (D58): what the site stores in the browser, and the choice about it. */
export default async function CookiesPage() {
  const chrome = await getPlatformChrome();
  const { cookies, categories } = await siteCookies(null, chrome.tracking);
  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10">
      <CookiePolicy lang="en" cookies={cookies} categories={categories} />
    </main>
  );
}
