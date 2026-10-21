import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Button, Card, CARD_CLASS, Chip, KpiTile, PageHeader } from "@/components/admin/ui";
import { HIDE_REASONS, REVIEW_ANSWER_MAX, REVIEW_STATUSES, type HideReason, type ReviewStatus } from "@/lib/review-status";
import { featureOn } from "@/lib/store-features";
import { listReviews, reviewCounts } from "@/server/reviews-admin";
import { reviewSettings } from "@/server/reviews";
import { memberCan, requirePermission } from "@/server/permissions";

import { answerReviewAction, hideReviewAction, publishReviewAction, savePublishModeAction } from "./actions";

export const metadata: Metadata = { title: "Reviews" };

const STATUS_WORDS: Record<ReviewStatus, string> = { pending: "Waiting", published: "Published", hidden: "Not shown" };
const STATUS_SIGNAL = { pending: "warning", published: "positive", hidden: "neutral" } as const;
const REASON_WORDS: Record<HideReason, string> = {
  not_about_product: "Not about the product",
  offensive: "Offensive or hateful",
  personal_data: "Holds personal details",
  spam: "Spam or advertising",
  other: "Another reason",
};

const first = (value: string | string[] | undefined): string => (typeof value === "string" ? value : "");
const stars = (n: number) => `${"★".repeat(n)}${"☆".repeat(5 - n)}`;

/**
 * Checking reviews (D301 G2, `docs/wave-5-marketing.md` 9.4): the ones waiting first, then all by state, searched by product or words and narrowed by
 * stars; each with Publish, Hide (a reason) and Answer for staff who may change products. Whether new reviews wait is the settings card. The page
 * stays while the feature is off: the reviews are kept.
 */
export default async function ReviewsPage({ params, searchParams }: PageProps<"/admin/[store]/reviews">) {
  const member = await requirePermission((await params).store, "products:read");
  const { store } = member;
  const query = await searchParams;
  const q = first(query.q).trim().slice(0, 100);
  const counts = await reviewCounts(store.id);
  const asked = first(query.state);
  // With nothing chosen, the queue when anything waits, else everything.
  const state: ReviewStatus | null = (REVIEW_STATUSES as readonly string[]).includes(asked)
    ? (asked as ReviewStatus)
    : asked === "all" || counts.pending === 0
      ? null
      : "pending";
  const starsAsked = Number(first(query.stars));
  const starFilter = Number.isInteger(starsAsked) && starsAsked >= 1 && starsAsked <= 5 ? starsAsked : null;
  const [at, id] = first(query.before).split("_");
  const before = at && id && !Number.isNaN(Date.parse(at)) && /^[0-9a-f-]{36}$/.test(id) ? { at, id } : null;
  const [page, settings] = await Promise.all([listReviews(store.id, { status: state, query: q, stars: starFilter, before }), reviewSettings(store.id)]);
  const base = `/admin/${store.slug}/reviews`;
  const canChange = memberCan(member, "products:write");
  const canOrders = memberCan(member, "orders:read");
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: store.timeZone });
  const link = (next: { state?: string | null; before?: string; stars?: number | null }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    const s = next.state === undefined ? (state ?? "all") : (next.state ?? "all");
    p.set("state", s);
    const st = next.stars === undefined ? starFilter : next.stars;
    if (st) p.set("stars", String(st));
    if (next.before) p.set("before", next.before);
    return `${base}?${p.toString()}`;
  };
  const total = REVIEW_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  const last = page.rows.at(-1);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reviews"
        description="What buyers say about your products. Only people who bought and received a product can review it; you decide what is shown."
      />

      {!featureOn(store, "reviews") && (
        <p className={`p-4 text-body text-ink-2 ${CARD_CLASS}`}>
          Reviews are switched off: they are not shown and customers cannot write new ones. Every review is kept here.{" "}
          <Link href={`/admin/${store.slug}/settings/features`} className="underline underline-offset-2">
            Features
          </Link>
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile label="Waiting to be checked" value={counts.pending.toLocaleString("en-GB")} href={link({ state: "pending" })} />
        <KpiTile label="Published" value={counts.published.toLocaleString("en-GB")} href={link({ state: "published" })} />
        <KpiTile label="Not shown" value={counts.hidden.toLocaleString("en-GB")} href={link({ state: "hidden" })} />
      </div>

      {total === 0 ? (
        <p className={`p-8 text-center text-body text-muted ${CARD_CLASS}`}>
          No reviews yet. Customers review what they bought from My account once it has reached them.
        </p>
      ) : (
        <Card
          compact
          title={state ? (state === "pending" ? "Waiting to be checked" : STATUS_WORDS[state]) : "All reviews"}
          aside={
            <form method="get" action={base} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="state" value={state ?? "all"} />
              <input type="search" name="q" defaultValue={q} placeholder="Product or words" aria-label="Search reviews" className="min-h-10 w-64 rounded-md border border-line px-3" />
              <Button type="submit">Search</Button>
            </form>
          }
        >
          <nav aria-label="Filter reviews" className="mb-4 flex flex-wrap gap-2">
            {[null, ...REVIEW_STATUSES].map((s) => (
              <Link
                key={s ?? "all"}
                href={link({ state: s })}
                aria-current={state === s ? "true" : undefined}
                className={`rounded-pill border px-3 py-1 text-caption ${state === s ? "border-edge bg-sunken text-ink" : "border-line text-ink-2"}`}
              >
                {s ? `${STATUS_WORDS[s]} ${counts[s]}` : `All ${total}`}
              </Link>
            ))}
            {[5, 4, 3, 2, 1].map((n) => (
              <Link
                key={n}
                href={link({ stars: starFilter === n ? null : n })}
                aria-current={starFilter === n ? "true" : undefined}
                aria-label={`${n} of 5 stars`}
                className={`rounded-pill border px-3 py-1 text-caption ${starFilter === n ? "border-edge bg-sunken text-ink" : "border-line text-ink-2"}`}
              >
                {n} ★
              </Link>
            ))}
          </nav>
          {page.rows.length === 0 ? (
            <p className="p-4 text-body text-muted">No review matches.</p>
          ) : (
            <ul className="divide-y divide-line">
              {page.rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-body-strong text-ink">{r.product}</p>
                      <p className="text-caption text-muted">
                        {[
                          r.source === "buyer" ? "Verified purchase" : `Imported from ${r.importedFrom}`,
                          r.bought,
                          r.authorName,
                          date(r.writtenAt),
                          r.editedAt ? `edited ${date(r.editedAt)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        {r.orderId && r.orderNumber && canOrders && (
                          <>
                            {" · "}
                            <Link href={`/admin/${store.slug}/orders/${r.orderId}`} className="underline underline-offset-2">
                              Order {r.orderNumber}
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                    <Chip signal={STATUS_SIGNAL[r.status]} dot>
                      {STATUS_WORDS[r.status]}
                      {r.hiddenReason ? `: ${REASON_WORDS[r.hiddenReason].toLowerCase()}` : ""}
                    </Chip>
                  </div>
                  <div>
                    <p className="text-body text-ink" aria-label={`${r.rating} of 5 stars`}>
                      <span aria-hidden>{stars(r.rating)}</span>
                    </p>
                    {r.title && <p className="text-body-strong text-ink" lang={r.locale}>{r.title}</p>}
                    {r.body && <p className="whitespace-pre-line text-body text-ink-2" lang={r.locale}>{r.body}</p>}
                  </div>
                  {canChange && (
                    <div className="flex flex-wrap items-start gap-3">
                      {r.status !== "published" && (
                        <ActionForm action={publishReviewAction.bind(null, store.slug, r.id)}>
                          <SubmitButton>Publish</SubmitButton>
                        </ActionForm>
                      )}
                      {r.status !== "hidden" && (
                        <details className="rounded-panel border border-line px-3 py-2">
                          <summary className="cursor-pointer text-body text-ink">Hide</summary>
                          <ActionForm action={hideReviewAction.bind(null, store.slug, r.id)} className="mt-2 flex flex-wrap items-end gap-2">
                            <label className="flex flex-col gap-1 text-body">
                              <span className="text-caption text-muted">Why it is not shown</span>
                              <select name="reason" required defaultValue="" className="min-h-10 rounded-md border border-line px-3">
                                <option value="" disabled>
                                  Choose
                                </option>
                                {HIDE_REASONS.map((reason) => (
                                  <option key={reason} value={reason}>
                                    {REASON_WORDS[reason]}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <SubmitButton variant="secondary">Hide</SubmitButton>
                            <p className="w-full text-caption text-muted">Hiding a review because it is negative is not allowed.</p>
                          </ActionForm>
                        </details>
                      )}
                      <details className="min-w-0 flex-1 rounded-panel border border-line px-3 py-2" open={Boolean(r.answer)}>
                        <summary className="cursor-pointer text-body text-ink">{r.answer ? "Your answer" : "Answer"}</summary>
                        <ActionForm action={answerReviewAction.bind(null, store.slug, r.id)} className="mt-2 flex flex-col gap-2">
                          <textarea
                            name="answer"
                            defaultValue={r.answer ?? ""}
                            maxLength={REVIEW_ANSWER_MAX}
                            rows={3}
                            aria-label="Your answer, shown under the review"
                            className="rounded-md border border-line px-3 py-2"
                          />
                          <div>
                            <SubmitButton variant="secondary">Save the answer</SubmitButton>
                          </div>
                        </ActionForm>
                      </details>
                    </div>
                  )}
                  {!canChange && r.answer && (
                    <p className="whitespace-pre-line border-l-2 border-line pl-3 text-body text-ink-2">{r.answer}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {page.more && last && (
            <div className="mt-4">
              <Link href={link({ before: `${last.writtenAt}_${last.id}` })} className="text-body text-ink-2 underline-offset-2 hover:underline">
                Older
              </Link>
            </div>
          )}
        </Card>
      )}

      <Card title="Checking new reviews" description="For reviews written or edited from now on; reviews already written keep their state." compact>
        {canChange ? (
          <ActionForm action={savePublishModeAction.bind(null, store.slug)} className="flex flex-col gap-3">
            <label className="flex items-start gap-2 text-body">
              <input type="radio" name="publish" value="after_check" defaultChecked={settings.publish === "after_check"} className="mt-1" />
              <span>
                <span className="block text-ink">Check each one first</span>
                <span className="block text-caption text-muted">A new or edited review waits here until you publish it.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-body">
              <input type="radio" name="publish" value="at_once" defaultChecked={settings.publish === "at_once"} className="mt-1" />
              <span>
                <span className="block text-ink">Publish at once</span>
                <span className="block text-caption text-muted">Reviews show as soon as they are written; you can hide one after.</span>
              </span>
            </label>
            <div>
              <SubmitButton>Save</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <p className="text-body text-ink">{settings.publish === "at_once" ? "Reviews are published at once." : "Each review is checked first."}</p>
        )}
      </Card>
    </div>
  );
}
