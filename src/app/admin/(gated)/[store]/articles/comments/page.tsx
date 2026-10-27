import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, CountBadge, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { COMMENT_STATUSES, type CommentStatus } from "@/lib/blog-comments";
import { commentCounts, listComments } from "@/server/blog-comments";
import { memberCan, requirePageTypeAccess } from "@/server/permissions";

import { moderateCommentAction } from "./actions";

export const metadata: Metadata = { title: "Comments" };

const TAB_ORDER: CommentStatus[] = ["pending", "approved", "spam", "rejected"];

/**
 * Visitors' comments on a store's articles (wave 7 unit G, D341): what waits first, with the spam check's findings beside each, and one press
 * to show, refuse, mark as spam or delete. A comment is the visitor's own words, drawn as plain text; its email is for staff only.
 */
export default async function CommentsPage({ params, searchParams }: PageProps<"/admin/[store]/articles/comments">) {
  const current = await requirePageTypeAccess((await params).store, "article", "read");
  const { store } = current;
  const editor = memberCan(current, "website:write");
  const lang = adminLangOf(current.account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = adminText(lang, "blog");
  const m = w.moderation;
  const query = await searchParams;
  const status: CommentStatus = (COMMENT_STATUSES as readonly unknown[]).includes(query.status) ? (query.status as CommentStatus) : "pending";
  const [counts, comments] = await Promise.all([commentCounts(store.id), listComments(store.id, status)]);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  const base = `/admin/${store.slug}/articles`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/blogs`, label: w.links.blogs }}
        title={m.title}
        description={m.description}
        meta={[counts.pending > 0 ? countWords(counts.pending, m.waiting) : null]}
      />
      <nav aria-label={m.title} className="flex flex-wrap gap-2">
        {TAB_ORDER.map((tab) => (
          <Link
            key={tab}
            href={`?status=${tab}`}
            aria-current={tab === status ? "page" : undefined}
            className="inline-flex min-h-10 items-center gap-2 rounded-pill border border-edge px-4 text-sm aria-[current=page]:bg-inverse aria-[current=page]:text-inverse-ink"
          >
            {m.tabs[tab]}
            <CountBadge count={counts[tab]} />
          </Link>
        ))}
      </nav>
      <Card title={m.tabs[status]} description={status === "spam" || status === "rejected" ? m.retention : m.plainText}>
        {comments.length === 0 ? (
          <p className="text-sm text-muted">{m.none[status]}</p>
        ) : (
          <ul role="list" className="divide-y divide-line">
            {comments.map((comment) => (
              <li key={comment.id} className="flex flex-col gap-2 py-4" data-comment-id={comment.id}>
                <p className="text-sm">
                  <span className="text-body-strong text-ink">{comment.name}</span>
                  <span className="text-muted">
                    {" · "}
                    {when.format(new Date(comment.createdAt))}
                    {" · "}
                    <Link href={`${base}/${comment.pageId}`} className="underline">
                      {fillWords(m.on, { article: comment.article })}
                    </Link>
                  </span>
                </p>
                <p className="whitespace-pre-line break-words text-body text-ink">{comment.body}</p>
                <p className="text-caption text-muted">{comment.email ? fillWords(m.email, { email: comment.email }) : m.noEmail}</p>
                {comment.spamReasons.length > 0 && (
                  <p className="text-caption text-warning-text">{fillWords(m.flagged, { reasons: comment.spamReasons.map((r) => m.reasons[r]).join(", ") })}</p>
                )}
                {editor && (
                  <ActionForm action={moderateCommentAction.bind(null, store.slug)} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={comment.id} />
                    {comment.status !== "approved" && (
                      <SubmitButton name="action" value="approve">
                        {m.approve}
                      </SubmitButton>
                    )}
                    {comment.status !== "rejected" && (
                      <SubmitButton variant="secondary" name="action" value="reject">
                        {m.reject}
                      </SubmitButton>
                    )}
                    {comment.status !== "spam" && (
                      <SubmitButton variant="secondary" name="action" value="spam">
                        {m.spam}
                      </SubmitButton>
                    )}
                    <SubmitButton variant="secondary" name="action" value="delete">
                      {m.remove}
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-sm">
        <ButtonLink kind="link" href={`${base}/blogs`}>
          {w.links.blogs}
        </ButtonLink>
      </p>
    </div>
  );
}
