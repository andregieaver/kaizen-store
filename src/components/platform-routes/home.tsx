import type { Metadata } from "next";
import Link from "next/link";

import { JsonLdScript } from "@/components/json-ld";
import { PlatformPageView, platformPageMetadata } from "@/components/platform-page";
import { storeBase, storeHref } from "@/lib/paths";
import { platformPath, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { siteUrl } from "@/lib/site";
import { platformJsonLd } from "@/lib/structured-data";
import { languageMeta } from "@/server/platform-lang-meta";
import { platformPageForRole } from "@/server/platform-roles";
import { getPlatformSeo, PLATFORM_DEFAULTS } from "@/server/seo";
import { templateStoreSlug } from "@/server/stores";

type Query = Promise<Record<string, string | string[] | undefined>>;

/** The front page's own search and sharing texts where one of Kaizen's pages is chosen for it (D143), in `lang` (D312). */
export async function homeMetadata(lang: PlatformLang): Promise<Metadata> {
  const [page, meta] = await Promise.all([platformPageForRole("front"), languageMeta(lang, "/")]);
  return page ? platformPageMetadata(page, "/", { lang, languages: meta.languages }) : { alternates: meta };
}

/** The platform's front page: one of Kaizen's own pages where one is chosen (D143), else the standard one. Sign-up opens with the invite-only beta. */
export async function HomeRoute({ lang, searchParams }: { lang: PlatformLang; searchParams: Query }) {
  const chosen = await platformPageForRole("front");
  if (chosen) return <PlatformPageView page={chosen} url="/" front query={searchParams} lang={lang} />;
  const [demo, seo] = await Promise.all([templateStoreSlug(), getPlatformSeo()]);
  const w = platformText(lang).home;
  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <JsonLdScript
        data={platformJsonLd({
          origin: siteUrl(),
          name: seo.title[lang] || seo.title.en || PLATFORM_DEFAULTS.title,
          description: seo.description[lang] || (lang === "en" ? seo.description.en || PLATFORM_DEFAULTS.description : platformText(lang).site.description),
          seo,
        })}
      />
      <h1 className="text-4xl font-semibold tracking-tight">Kaizena Flow</h1>
      <p className="text-lg">{w.lead}</p>
      <p className="text-muted">{w.beta}</p>
      <div className="flex flex-wrap gap-3">
        <Link
          href={platformPath(lang, "/sign-up")}
          className="rounded-full bg-foreground px-5 py-2.5 font-medium text-background"
        >
          {w.start}
        </Link>
        {demo && (
          <Link href={storeHref(demo, storeBase(demo))} className="rounded-full border border-border px-5 py-2.5 font-medium">
            {w.demo}
          </Link>
        )}
        <Link href="/admin" className="rounded-full border border-border px-5 py-2.5 font-medium">
          {w.signIn}
        </Link>
      </div>
    </main>
  );
}
