import Image from "next/image";

import { browserText } from "@/lib/browser-text";
import type { BlogAuthor } from "@/lib/blogs";
import { isSafeAddress } from "@/lib/field-parts";
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
  inAdmin = false,
  editable = false,
  author = null,
}: {
  content: PageContent;
  /** When it was first published; a draft's preview has none yet. */
  date: string | null;
  /** Who wrote it: its author, else the store or Kaizen. */
  byline: string;
  lang: string;
  locale: string;
  place: GridPlace;
  /** Shown in the admin (a preview), where its own CSS stays inside it (D100). */
  inAdmin?: boolean;
  /** Signed-in staff may change its headings' and texts' words where they stand (D192): `PageArticle`'s. */
  editable?: boolean;
  /** Its author record (D341), drawn after the article with their picture, short text and link; none, the byline only. */
  author?: BlogAuthor | null;
}) {
  const m = t(lang);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Oslo" });
  return (
    <article className="flex flex-col gap-8">
      <header className="mx-auto flex w-full max-w-(--content-width) flex-col gap-4 px-4">
        <h1 className="text-3xl font-heading tracking-tight text-balance kzb-md-text-4xl">{content.title}</h1>
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
      <PageArticle content={content} place={place} titled inAdmin={inAdmin} editable={editable} />
      {author && <AuthorBox author={author} lang={lang} />}
    </article>
  );
}

/** An article's author (D341): their picture, name, short text and link (drawn only when it is a safe address). Their words are text. */
function AuthorBox({ author, lang }: { author: BlogAuthor; lang: string }) {
  const m = browserText(lang).blogComments;
  const link = author.link && isSafeAddress(author.link) ? author.link.trim() : null;
  return (
    <aside aria-label={m.aboutAuthor} data-blog-author="" className="mx-auto flex w-full max-w-(--content-width) gap-4 px-4">
      {author.picture && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={author.picture} alt="" width={72} height={72} loading="lazy" className="size-18 shrink-0 rounded-full bg-surface object-cover" />
      )}
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">{m.aboutAuthor}</p>
        <p className="text-lg font-heading">{author.name}</p>
        {author.bio && <p className="whitespace-pre-line">{author.bio}</p>}
        {link && (
          <a href={link} className="w-fit underline" rel={link.startsWith("/") || link.startsWith("#") ? undefined : "noopener"}>
            {m.authorLink}
          </a>
        )}
      </div>
    </aside>
  );
}
