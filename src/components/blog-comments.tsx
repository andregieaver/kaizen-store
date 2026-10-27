import { browserText } from "@/lib/browser-text";
import type { BlogCommentSetting } from "@/lib/blogs";
import type { ShownComment } from "@/server/blog-comments";

import { BlogCommentForm } from "./blog-comment-form";

/**
 * An article's comments (D341): the approved ones, oldest first, and the form while the blog takes comments. A comment's words are plain
 * text, drawn as text (never HTML), with the visitor's own line breaks. With comments off on the blog nothing is drawn: no form and no
 * comments, even approved ones.
 */
export function BlogComments({
  setting,
  comments,
  store,
  market,
  article,
  lang,
  locale,
}: {
  setting: BlogCommentSetting;
  comments: readonly ShownComment[];
  store: string;
  market: string;
  article: string;
  lang: string;
  locale: string;
}) {
  if (setting === "off") return null;
  const m = browserText(lang).blogComments;
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Oslo" });
  return (
    <section aria-labelledby="comments-heading" data-blog-comments="" className="mx-auto mt-12 flex w-full max-w-(--content-width) flex-col gap-6 px-4">
      <h2 id="comments-heading" className="text-2xl font-heading tracking-tight">
        {m.heading}
      </h2>
      {comments.length === 0 ? (
        <p className="text-muted">{m.none}</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-lg border border-border p-4" data-comment="">
              <p className="text-sm">
                <span className="font-medium">{comment.name}</span>
                <span className="text-muted">
                  {" · "}
                  <time dateTime={comment.createdAt}>{day.format(new Date(comment.createdAt))}</time>
                </span>
              </p>
              <p className="mt-2 whitespace-pre-line break-words">{comment.body}</p>
            </li>
          ))}
        </ol>
      )}
      <BlogCommentForm store={store} market={market} article={article} lang={lang} />
    </section>
  );
}
