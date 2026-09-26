import Image from "next/image";

import { t } from "@/lib/i18n";
import type { PageContent } from "@/lib/page-content";
import type { GridPlace } from "@/server/content-grid";

import { PageArticle } from "./page-article";

/**
 * An article (D57): a header drawn from its settings (title, the day it was
 * first published, its author, its picture) above the rows built in the page
 * builder, so every article in the blog looks alike at the top. Kaizen's in
 * English, a store's in the market's language.
 */
export function ArticleView({
  content,
  date,
  byline,
  lang,
  locale,
  place,
}: {
  content: PageContent;
  /** When it was first published; a draft's preview has none yet. */
  date: string | null;
  /** Who wrote it: its author, else the store or Kaizen. */
  byline: string;
  lang: string;
  locale: string;
  place: GridPlace;
}) {
  const m = t(lang);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Oslo" });
  return (
    <article className="flex flex-col gap-8">
      <header className="mx-auto flex w-full max-w-(--content-width) flex-col gap-4 px-4">
        <h1 className="text-3xl font-heading tracking-tight text-balance md:text-4xl">{content.title}</h1>
        <p className="text-sm text-muted">
          {date && (
            <>
              <time dateTime={date}>{day.format(new Date(date))}</time>
              {" · "}
            </>
          )}
          {m.byAuthor(byline)}
        </p>
        {content.thumbnail && (
          <Image
            src={content.thumbnail.url}
            alt={content.thumbnail.alt}
            width={content.thumbnail.width}
            height={content.thumbnail.height}
            unoptimized
            priority
            className="h-auto w-full rounded-lg bg-surface"
          />
        )}
      </header>
      <PageArticle content={content} place={place} titled />
    </article>
  );
}
