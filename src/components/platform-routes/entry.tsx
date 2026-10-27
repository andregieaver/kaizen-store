import type { Metadata } from "next";

import { CustomFieldsList } from "@/components/custom-fields-view";
import { JsonLdScript } from "@/components/json-ld";
import { entryPicture, entrySeoIn, entrySummary, entryTitle } from "@/lib/content-types";
import { PLATFORM_LANG_FACTS, pageLocaleOf, platformPath, type PlatformLang } from "@/lib/platform-lang";
import { summarize } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { pageJsonLd } from "@/lib/structured-data";
import type { EntryPage } from "@/server/content-site";
import { shownPlatformEntryFields } from "@/server/custom-fields";
import { languageMeta } from "@/server/platform-lang-meta";

/**
 * One of Kaizena Flow's own entries on its own page (wave 6 unit H4, D326), at `/{type}/{entry}` and `/no/{type}/{entry}` when no page has
 * that address: the standard entry view (its title, its picture and every public field) in the site's language, English where a text has
 * no Norwegian. Only a published entry of a type with pages gets here (`findEntryPage(null, …)`).
 */

const pathOf = ({ type, entry }: EntryPage) => `/${type.slug}/${entry.slug}`;

export async function platformEntryMetadata(lang: PlatformLang, found: EntryPage): Promise<Metadata> {
  const locale = pageLocaleOf(lang) ?? "en";
  const { type, entry } = found;
  const seo = entrySeoIn(entry.content, locale, "en");
  const title = entryTitle(type, entry.content.data, locale, "en") || entry.slug;
  const description = summarize(seo.description || entrySummary(type, entry.content.data, locale, "en"));
  const picture = entryPicture(type, entry.content.data);
  const url = platformPath(lang, pathOf(found));
  const images = picture ? [{ url: picture.url, alt: picture.alt || title }] : [{ url: "/og.png", alt: "Kaizena Flow", width: 1200, height: 630 }];
  return {
    title: seo.title ? { absolute: seo.title } : title,
    ...(description && { description }),
    alternates: { canonical: url, languages: (await languageMeta(lang, pathOf(found))).languages },
    openGraph: { type: "article", siteName: "Kaizena Flow", locale: PLATFORM_LANG_FACTS[lang].ogLocale, url, title: seo.title || title, description, images },
    twitter: { card: "summary_large_image", title: seo.title || title, description, images },
  };
}

export async function PlatformEntryView({ lang, found }: { lang: PlatformLang; found: EntryPage }) {
  const locale = pageLocaleOf(lang) ?? "en";
  const { type, entry } = found;
  const origin = siteUrl();
  const data = entry.content.data;
  const title = entryTitle(type, data, locale, "en") || entry.slug;
  const picture = entryPicture(type, data);
  const fields = await shownPlatformEntryFields(entry.id, lang);
  const rest = fields.flatMap((group) => group.fields).filter((field) => field.id !== type.titleField && field.id !== type.pictureField);
  return (
    <main id="main" className="w-full flex-1 pt-10 pb-10">
      <JsonLdScript
        data={pageJsonLd({
          origin,
          url: `${origin}${platformPath(lang, pathOf(found))}`,
          title,
          description: entrySeoIn(entry.content, locale, "en").description || entrySummary(type, data, locale, "en"),
          image: picture?.url ?? null,
          publishedAt: entry.firstPublishedAt,
        })}
      />
      <article className="mx-auto flex w-full max-w-(--content-width) flex-col gap-6 px-4">
        <h1 className="font-heading text-3xl">{title}</h1>
        {picture && (
          // eslint-disable-next-line @next/next/no-img-element -- a library picture whose size is not known here; its alt text names it
          <img src={picture.url} alt={picture.alt || title} className="max-h-[32rem] w-full rounded-lg object-cover" />
        )}
        <CustomFieldsList fields={rest} />
      </article>
    </main>
  );
}
