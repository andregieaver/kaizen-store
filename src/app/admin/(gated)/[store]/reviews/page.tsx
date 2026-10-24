import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Button, ButtonLink, Card, CARD_CLASS, Chip, KpiTile, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { HIDE_REASONS, REQUEST_DAYS_MAX, REQUEST_DAYS_MIN, REVIEW_ANSWER_MAX, REVIEW_STATUSES, type ReviewStatus } from "@/lib/review-status";
import { featureOn } from "@/lib/store-features";
import { listReviews, reviewCounts } from "@/server/reviews-admin";
import { requestsSent } from "@/server/review-requests";
import { reviewSettings } from "@/server/reviews";
import { memberCan, requirePermission } from "@/server/permissions";

import { answerReviewAction, hideReviewAction, publishReviewAction, savePublishModeAction, saveRequestSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Reviews" };

const STATUS_SIGNAL = { pending: "warning", published: "positive", hidden: "neutral" } as const;

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
  const [page, settings, sent] = await Promise.all([
    listReviews(store.id, { status: state, query: q, stars: starFilter, before }),
    reviewSettings(store.id),
    requestsSent(store.id),
  ]);
  const base = `/admin/${store.slug}/reviews`;
  const canChange = memberCan(member, "products:write");
  const canOrders = memberCan(member, "orders:read");
  const lang = adminLangOf(member.account.adminLocale);
  const words = adminText(lang, "reviews");
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={w.description}
      />

      {!featureOn(store, "reviews") && (
        <p className={`p-4 text-body text-ink-2 ${CARD_CLASS}`}>
          {w.off}{" "}
          <Link href={`/admin/${store.slug}/settings/features`} className="underline underline-offset-2">
            {w.features}
          </Link>
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile label={w.waiting} value={counts.pending.toLocaleString(dateLocale)} href={link({ state: "pending" })} />
        <KpiTile label={w.published} value={counts.published.toLocaleString(dateLocale)} href={link({ state: "published" })} />
        <KpiTile label={w.hidden} value={counts.hidden.toLocaleString(dateLocale)} href={link({ state: "hidden" })} />
      </div>

      {total === 0 ? (
        <p className={`p-8 text-center text-body text-muted ${CARD_CLASS}`}>
          {w.empty}
        </p>
      ) : (
        <Card
          compact
          title={state ? (state === "pending" ? w.waiting : STATUS_WORDS[state]) : w.all}
          aside={
            <form method="get" action={base} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="state" value={state ?? "all"} />
              <input type="search" name="q" defaultValue={q} placeholder={w.searchPlaceholder} aria-label={w.searchLabel} className="min-h-10 w-64 rounded-md border border-line px-3" />
              <Button type="submit">{w.search}</Button>
            </form>
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
            <p className="p-4 text-body text-muted">{w.noMatch}</p>
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
                              <select name="reason" required defaultValue="" className="min-h-10 rounded-md border border-line px-3">
                                <option value="" disabled>
                                  {w.choose}
                                </option>
                                {HIDE_REASONS.map((reason) => (
                                  <option key={reason} value={reason}>
                                    {REASON_WORDS[reason]}
                                  </option>
                                ))}
                              </select>
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

      <Card title={w.checkingTitle} description={w.checkingDescription} compact>
        {canChange ? (
          <ActionForm action={savePublishModeAction.bind(null, store.slug)} className="flex flex-col gap-3">
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
        ) : (
          <p className="text-body text-ink">{settings.publish === "at_once" ? w.isAtOnce : w.isChecked}</p>
        )}
      </Card>

      <Card title={w.requestsTitle} description={w.requestsDescription} compact>
        {canChange ? (
          <ActionForm action={saveRequestSettingsAction.bind(null, store.slug)} className="flex flex-col gap-3">
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
        ) : (
          <p className="text-body text-ink">{settings.requestsOn ? fillWords(w.requestsIsOn, { days: settings.requestDays }) : w.requestsIsOff}</p>
        )}
        {settings.requestsOn && <p className="mt-3 text-caption text-muted">{countWords(sent, w.requestsSent)}</p>}
      </Card>

      <Card title={words.move.title} description={words.move.description} compact>
        <div className="flex flex-wrap items-center gap-3">
          {canChange && (
            <ButtonLink href={`${base}/import`} kind="secondary">
              {words.move.importLink}
            </ButtonLink>
          )}
          <form method="post" action={`${base}/export`}>
            <Button type="submit" kind="secondary">
              {words.move.export}
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
