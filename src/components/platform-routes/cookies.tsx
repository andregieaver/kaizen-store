import type { Metadata } from "next";

import { CookiePolicy } from "@/components/consent/cookie-policy";
import { PLATFORM_LANG_FACTS, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { getPlatformChrome } from "@/server/platform-navigation";
import { languageMeta } from "@/server/platform-lang-meta";
import { siteCookies } from "@/server/site-cookies";

export async function cookiesMetadata(lang: PlatformLang): Promise<Metadata> {
  return {
    title: platformText(lang).cookies.title,
    description: platformText(lang).cookies.description,
    alternates: await languageMeta(lang, "/cookies"),
  };
}

/** Kaizen's cookie page (D58): what the site stores in the browser, and the choice about it, in `lang`'s words (D312). */
export async function CookiesRoute({ lang }: { lang: PlatformLang }) {
  const chrome = await getPlatformChrome();
  const { cookies, categories } = await siteCookies(null, chrome.tracking);
  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10">
      <CookiePolicy lang={PLATFORM_LANG_FACTS[lang].messages} cookies={cookies} categories={categories} />
    </main>
  );
}
