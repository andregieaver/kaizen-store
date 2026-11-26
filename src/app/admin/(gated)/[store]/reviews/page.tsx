import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, CARD_CLASS, Chip, EmptyState, KpiTile, ListSearch, PageHeader, Select } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { HIDE_REASONS, REQUEST_DAYS_MAX, REQUEST_DAYS_MIN, REVIEW_ANSWER_MAX, REVIEW_STATUSES, type ReviewStatus } from "@/lib/review-status";
import { featureOn } from "@/lib/store-features";
import { REVIEWS_WORDS } from "@/lib/admin-words/reviews";
import { listReviews, reviewCounts } from "@/server/reviews-admin";
import { requestsSent } from "@/server/review-requests";
import { reviewSettings } from "@/server/reviews";
import { memberCan, requirePermission } from "@/server/permissions";

import { switchOnFromPageAction } from "../settings/features/actions";
import { MoreMenu } from "@/components/admin/orders/order-folds";
import { answerReviewAction, hideReviewAction, pictureHiddenAction, publishReviewAction, savePublishModeAction, saveRequestSettingsAction } from "./actions";
import { QuickTask } from "@/components/admin/projects/quick-task";
import { projectsAction } from "@/app/admin/(gated)/[store]/projects/actions";
import { PROJECT_SOURCES_WORDS } from "@/lib/admin-words/project-sources";
import { projectsOn } from "@/lib/extensions";

export const metadata: Metadata = { title: "Reviews" };

const STATUS_SIGNAL = { pending: "warning", published: "positive", hidden: "neutral" } as const;

const first = (value: string | string[] | undefined): string => (typeof value === "string" ? value : "");
const summaryRow = "flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-3 [&::-webkit-details-marker]:hidden";
const rowAction = "shrink-0 text-sm font-medium text-ink underline underline-offset-2";
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
  const [page, settings, sent] = await Promise.all([
    listReviews(store.id, { status: state, query: q, stars: starFilter, before }),
    reviewSettings(store.id),
    requestsSent(store.id),
  ]);
  const base = `/admin/${store.slug}/reviews`;
  const canChange = memberCan(member, "products:write");
  const canOrders = memberCan(member, "orders:read");
  const lang = adminLangOf(member.account.adminLocale);
  // A pair of the octopus (D904 P8.3a): a review becomes a task while the store has Projects too.
  const reviewTasks =
    projectsOn(member.store) && memberCan(member, "projects:write") ? { words: PROJECT_SOURCES_WORDS[lang], act: projectsAction.bind(null, member.store.slug) } : null;
  const words = REVIEWS_WORDS[lang];
  const w = words.page;
  const STATUS_WORDS = words.statuses;
  const REASON_WORDS = words.reasons;
  // English keeps en-GB dates and numbers, as before; another language its own.
  const dateLocale = lang === "en" ? "en-GB" : ADMIN_LANG_FACTS[lang].locale;
  const date = (iso: string) => new Date(iso).toLocaleDateString(dateLocale, { dateStyle: "medium", timeZone: store.timeZone });
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
  const on = featureOn(store, "reviews");
  const owner = memberCan(member, "owner");

  return (
    <div className="flex flex-col gap-6">
      {/* Round 12 (D637): what waits in the sentence, Show reviews when they are off, zeros not shown, import and export under More. */}
      <PageHeader
        title={w.title}
        meta={[
          <span key="lead">
            <span className="text-ink">
              {!on
                ? w.leadOff
                : total === 0
                  ? w.leadNone
                  : counts.pending > 0
                    ? countWords(counts.pending, w.leadWaiting)
                    : countWords(counts.published, w.leadPublished)}
            </span>
            {!on ? w.leadOffRest : total === 0 ? w.leadNoneRest : w.leadRest}
          </span>,
        ]}
        actions={
          <>
            <MoreMenu label={w.more}>
              {canChange && (
                <ButtonLink kind="quiet" href={`${base}/import`}>
                  {words.move.importLink}
                </ButtonLink>
              )}
              <form method="post" action={`${base}/export`}>
                <button type="submit" className="inline-flex min-h-10 w-full items-center rounded-pill px-4 text-sm font-medium hover:bg-sunken">
                  {words.move.export}
                </button>
              </form>
            </MoreMenu>
            {!on && owner && (
              <ActionForm action={switchOnFromPageAction.bind(null, store.slug, "reviews")}>
                <SubmitButton>{w.showReviews}</SubmitButton>
              </ActionForm>
            )}
          </>
        }
      />

      {total > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {counts.pending > 0 && <KpiTile label={w.waiting} value={counts.pending.toLocaleString(dateLocale)} href={link({ state: "pending" })} />}
          {counts.published > 0 && <KpiTile label={w.published} value={counts.published.toLocaleString(dateLocale)} href={link({ state: "published" })} />}
          {counts.hidden > 0 && <KpiTile label={w.hidden} value={counts.hidden.toLocaleString(dateLocale)} href={link({ state: "hidden" })} />}
        </div>
      )}

      {total > 0 && (
        <Card
          compact
          title={state ? (state === "pending" ? w.waiting : STATUS_WORDS[state]) : w.all}
          aside={
            <ListSearch action={base} value={q} placeholder={w.searchPlaceholder} words={{ label: w.searchLabel, button: w.search }} keep={{ state: state ?? "all" }} />
          }
        >
          <nav aria-label={w.filterLabel} className="mb-4 flex flex-wrap gap-2">
            {[null, ...REVIEW_STATUSES].map((s) => (
              <Link
                key={s ?? "all"}
                href={link({ state: s })}
                aria-current={state === s ? "true" : undefined}
                className={`rounded-pill border px-3 py-1 text-caption ${state === s ? "border-edge bg-sunken text-ink" : "border-line text-ink-2"}`}
              >
                {s ? `${STATUS_WORDS[s]} ${counts[s]}` : fillWords(w.allCount, { count: total })}
              </Link>
            ))}
            {[5, 4, 3, 2, 1].map((n) => (
              <Link
                key={n}
                href={link({ stars: starFilter === n ? null : n })}
                aria-current={starFilter === n ? "true" : undefined}
                aria-label={fillWords(w.starsLabel, { n })}
                className={`rounded-pill border px-3 py-1 text-caption ${starFilter === n ? "border-edge bg-sunken text-ink" : "border-line text-ink-2"}`}
              >
                {n} ★
              </Link>
            ))}
          </nav>
          {page.rows.length === 0 ? (
            <EmptyState title={w.noMatch} />
          ) : (
            <ul className="divide-y divide-line">
              {page.rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-body-strong text-ink">{r.product}</p>
                      <p className="text-caption text-muted">
                        {[
                          r.source === "buyer" ? w.verified : fillWords(w.importedFrom, { source: r.importedFrom ?? "" }),
                          r.bought,
                          r.authorName,
                          date(r.writtenAt),
                          r.editedAt ? fillWords(w.edited, { date: date(r.editedAt) }) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        {r.orderId && r.orderNumber && canOrders && (
                          <>
                            {" · "}
                            <Link href={`/admin/${store.slug}/orders/${r.orderId}`} className="underline underline-offset-2">
                              {fillWords(w.order, { number: r.orderNumber })}
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
                    <p className="text-body text-ink" aria-label={fillWords(w.starsLabel, { n: r.rating })}>
                      <span aria-hidden>{stars(r.rating)}</span>
                    </p>
                    {r.title && <p className="text-body-strong text-ink" lang={r.locale}>{r.title}</p>}
                    {r.body && <p className="whitespace-pre-line text-body text-ink-2" lang={r.locale}>{r.body}</p>}
                  </div>
                  {reviewTasks && (
                    <QuickTask
                      base={`/admin/${store.slug}`}
                      kind="review"
                      sourceId={r.id}
                      label={r.authorName}
                      words={reviewTasks.words}
                      act={reviewTasks.act}
                      className="flex flex-col gap-2 text-sm"
                    />
                  )}
                  {r.pictures.length > 0 && (
                    <ul className="flex flex-wrap gap-3">
                      {r.pictures.map((p, i) => (
                        <li key={p.id} className="flex flex-col items-start gap-1">
                          <a href={`/admin/${store.slug}/reviews/picture/${p.id}`} target="_blank" rel="noopener" className="block rounded-panel border border-line">
                            {/* eslint-disable-next-line @next/next/no-img-element -- a private file served to staff by its own route */}
                            <img
                              src={`/admin/${store.slug}/reviews/picture/${p.id}?size=480`}
                              alt={fillWords(w.pictureAlt, { n: i + 1 })}
                              loading="lazy"
                              className={`block h-24 w-auto rounded-panel object-cover${p.hidden ? " opacity-40" : ""}`}
                            />
                          </a>
                          {p.hidden && <Chip signal="neutral">{w.pictureHidden}</Chip>}
                          {canChange && (
                            <ActionForm action={pictureHiddenAction.bind(null, store.slug, p.id, !p.hidden)}>
                              <SubmitButton variant="secondary">{p.hidden ? w.pictureShow : w.pictureHide}</SubmitButton>
                            </ActionForm>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {canChange && (
                    <div className="flex flex-wrap items-start gap-3">
                      {r.status !== "published" && (
                        <ActionForm action={publishReviewAction.bind(null, store.slug, r.id)}>
                          <SubmitButton>{w.publish}</SubmitButton>
                        </ActionForm>
                      )}
                      {r.status !== "hidden" && (
                        <details className="rounded-panel border border-line px-3 py-2">
                          <summary className="cursor-pointer text-body text-ink">{w.hide}</summary>
                          <ActionForm action={hideReviewAction.bind(null, store.slug, r.id)} className="mt-2 flex flex-wrap items-end gap-2">
                            <label className="flex flex-col gap-1 text-body">
                              <span className="text-caption text-muted">{w.whyHidden}</span>
                              <Select name="reason" required defaultValue="">
                                <option value="" disabled>
                                  {w.choose}
                                </option>
                                {HIDE_REASONS.map((reason) => (
                                  <option key={reason} value={reason}>
                                    {REASON_WORDS[reason]}
                                  </option>
                                ))}
                              </Select>
                            </label>
                            <SubmitButton variant="secondary">{w.hide}</SubmitButton>
                            <p className="w-full text-caption text-muted">{w.negativeNote}</p>
                          </ActionForm>
                        </details>
                      )}
                      <details className="min-w-0 flex-1 rounded-panel border border-line px-3 py-2" open={Boolean(r.answer)}>
                        <summary className="cursor-pointer text-body text-ink">{r.answer ? w.yourAnswer : w.answer}</summary>
                        <ActionForm action={answerReviewAction.bind(null, store.slug, r.id)} className="mt-2 flex flex-col gap-2">
                          <textarea
                            name="answer"
                            defaultValue={r.answer ?? ""}
                            maxLength={REVIEW_ANSWER_MAX}
                            rows={3}
                            aria-label={w.answerLabel}
                            className="rounded-md border border-line px-3 py-2"
                          />
                          <div>
                            <SubmitButton variant="secondary">{w.saveAnswer}</SubmitButton>
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
                {w.older}
              </Link>
            </div>
          )}
        </Card>
      )}

      <section aria-labelledby="how" className={`px-6 py-3 ${CARD_CLASS}`}>
        <h2 id="how" className="mt-2 mb-1 text-title text-ink">{w.howTitle}</h2>
        <ul className="divide-y divide-line">
          <li>
            {canChange ? (
              <details>
                <summary className={summaryRow}>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-body text-ink">{settings.publish === "at_once" ? w.isAtOnce : w.isChecked}</span>
                    <span className="text-caption text-ink-2">{settings.publish === "at_once" ? w.atOnceHint : w.checkFirstHint}</span>
                  </span>
                  <span className={rowAction}>{w.change}</span>
                </summary>
                <ActionForm action={savePublishModeAction.bind(null, store.slug)} className="flex flex-col gap-3 pb-5">
                  <label className="flex items-start gap-2 text-body">
                    <input type="radio" name="publish" value="after_check" defaultChecked={settings.publish === "after_check"} className="mt-1" />
                    <span>
                      <span className="block text-ink">{w.checkFirst}</span>
                      <span className="block text-caption text-muted">{w.checkFirstHint}</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-body">
                    <input type="radio" name="publish" value="at_once" defaultChecked={settings.publish === "at_once"} className="mt-1" />
                    <span>
                      <span className="block text-ink">{w.atOnce}</span>
                      <span className="block text-caption text-muted">{w.atOnceHint}</span>
                    </span>
                  </label>
                  <div>
                    <SubmitButton>{w.save}</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            ) : (
              <p className="flex min-h-14 items-center py-3 text-body text-ink">{settings.publish === "at_once" ? w.isAtOnce : w.isChecked}</p>
            )}
          </li>
          <li>
            {canChange ? (
              <details>
                <summary className={summaryRow}>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-body text-ink">{settings.requestsOn ? fillWords(w.requestsIsOn, { days: settings.requestDays }) : w.requestsIsOff}</span>
                    <span className="text-caption text-ink-2">{settings.requestsOn ? countWords(sent, w.requestsSent) : w.askHint}</span>
                  </span>
                  <span className={rowAction}>{settings.requestsOn ? w.change : w.askBuyers}</span>
                </summary>
                <ActionForm action={saveRequestSettingsAction.bind(null, store.slug)} className="flex flex-col gap-3 pb-5">
                  <p className="text-caption text-muted">{w.requestsDescription}</p>
                  <label className="flex items-center gap-2 text-body text-ink">
                    <input type="checkbox" name="requests" defaultChecked={settings.requestsOn} />
                    {w.requestsOn}
                  </label>
                  <label className="flex flex-col gap-1 text-body">
                    <span className="text-ink">{w.requestDays}</span>
                    <input
                      type="number"
                      name="days"
                      min={REQUEST_DAYS_MIN}
                      max={REQUEST_DAYS_MAX}
                      defaultValue={settings.requestDays}
                      className="w-28 rounded-lg border border-line bg-card px-3 py-2"
                    />
                    <span className="text-caption text-muted">{fillWords(w.requestDaysHint, { min: REQUEST_DAYS_MIN, max: REQUEST_DAYS_MAX })}</span>
                  </label>
                  <div>
                    <SubmitButton>{w.save}</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            ) : (
              <p className="flex min-h-14 items-center py-3 text-body text-ink">
                {settings.requestsOn ? fillWords(w.requestsIsOn, { days: settings.requestDays }) : w.requestsIsOff}
              </p>
            )}
          </li>
        </ul>
      </section>
    </div>
  );
}
