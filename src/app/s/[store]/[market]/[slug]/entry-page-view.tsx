import type { Metadata } from "next";

import { CustomFieldsList } from "@/components/custom-fields-view";
import { JsonLdScript } from "@/components/json-ld";
import { StorePageArticle } from "@/components/store-page-article";
import { entryPicture, entrySeoIn, entrySummary, entryTitle } from "@/lib/content-types";
import { bindPage } from "@/lib/field-binding";
import type { Market } from "@/lib/markets";
import { localizePage } from "@/lib/page-translation";
import { marketMetaPath, marketPath, storeSiteUrl } from "@/lib/paths";
import { summarize } from "@/lib/seo";
import { pageJsonLd } from "@/lib/structured-data";
import type { EntryPage } from "@/server/content-site";
import { shownEntryFields, shownFieldsFor } from "@/server/custom-fields";
import { storeFacts, storeShareImage, storeShareTags } from "@/server/seo";
import type { Store } from "@/server/stores";

/**
 * A content entry's own page (wave 6 unit H2, D326), at `/{type}/{entry}` when no page has that address: drawn by its type's published
 * entry layout with its bound blocks taking the entry's public fields, else the standard view (its picture, its title and every public
 * field). Only a published entry of a type with pages gets here (`findEntryPage()`).
 */

/** What an entry page says to search engines and when shared: its search texts, else its title and summary. */
export function entryPageMetadata(store: Store, market: Market, found: EntryPage): Metadata {
  const main = store.localization.locales[0] ?? market.locale;
  const { type, entry } = found;
  const seo = entrySeoIn(entry.content, market.locale, main);
  const title = entryTitle(type, entry.content.data, market.locale, main) || entry.slug;
  const description = summarize(seo.description || entrySummary(type, entry.content.data, market.locale, main));
  const picture = entryPicture(type, entry.content.data);
  const path = (m: Market) => marketMetaPath(store.slug, m.slug, `/${type.slug}/${entry.slug}`);
  return {
    title: seo.title ? { absolute: seo.title } : title,
    ...(description && { description }),
    alternates: { canonical: path(market), languages: Object.fromEntries(store.markets.map((m) => [m.locale, path(m)])) },
    ...storeShareTags(store, market, {
      title: seo.title || title,
      description,
      url: path(market),
      images: picture ? [{ url: picture.url, alt: picture.alt || title }] : [storeShareImage(store, market.locale)],
    }),
  };
}

export async function EntryPageView({ store, market, found }: { store: Store; market: Market; found: EntryPage }) {
  const main = store.localization.locales[0] ?? market.locale;
  const { type, entry, layout } = found;
  const home = marketPath(store.slug, market.slug);
  const origin = storeSiteUrl(store.slug);
  const data = entry.content.data;
  const title = entryTitle(type, data, market.locale, main) || entry.slug;
  const picture = entryPicture(type, data);
  const fields = await shownEntryFields(store.id, entry.id, market.locale, market.lang, market.slug);
  const jsonLd = (
    <JsonLdScript
      data={pageJsonLd({
        origin,
        url: `${origin}${home}/${type.slug}/${entry.slug}`,
        title,
        description: entrySeoIn(entry.content, market.locale, main).description || entrySummary(type, data, market.locale, main),
        image: picture?.url ?? null,
        publishedAt: entry.firstPublishedAt,
        store: { homeUrl: `${origin}${home}`, storeUrl: storeFacts(store).url, locale: market.locale },
      })}
    />
  );

  if (layout) {
    // The layout's blocks bound to the entry's fields show its values (D119); blocks bound to the store's own fields (D120) its.
    const storeFields = await shownFieldsFor(store.id, "store", store.id, market.locale, market.lang, market.slug);
    const content = bindPage(localizePage(layout, market.locale), fields, storeFields);
    return (
      <>
        {jsonLd}
        <StorePageArticle content={content} place={{ pageId: null, owner: store.id, market: market.slug }} />
      </>
    );
  }

  // The standard entry page: the title, the picture and every other public field, as the custom fields draw them.
  const rest = fields.flatMap((group) => group.fields).filter((field) => field.id !== type.titleField && field.id !== type.pictureField);
  return (
    <>
      {jsonLd}
      <article className="mx-auto flex w-full max-w-(--content-width) flex-col gap-6 px-4 py-8">
        <h1 className="font-heading text-3xl">{title}</h1>
        {picture && (
          // eslint-disable-next-line @next/next/no-img-element -- a library picture whose size is not known here; its alt text names it
          <img src={picture.url} alt={picture.alt || title} className="max-h-[32rem] w-full rounded-lg object-cover" />
        )}
        <CustomFieldsList fields={rest} />
      </article>
    </>
  );
}
