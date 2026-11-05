import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { IntegrationMark } from "@/components/admin/integration-mark";
import { Chip, List, ListRow, PageHeader, RowDate, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { todayIn } from "@/lib/analytics-period";
import { norwegianOrgNumber } from "@/lib/tripletex";
import { failureWords } from "@/lib/tripletex-errors";
import { BOOKING_KEYS, DEFAULT_BOOKING, type BookingKey } from "@/lib/tripletex-settings";
import { bookingProblem, receivableProblem, type Chart, type SettingsProblem } from "@/lib/tripletex-setup";
import { memberCan, requirePermission } from "@/server/permissions";
import { checkTripletexSettings, getTripletexConnection, storeOrgNumber, tripletexCounts, tripletexProblems } from "@/server/tripletex";

import {
  chooseAccountAction,
  connectTripletexAction,
  disconnectTripletexAction,
  pauseTripletexAction,
  retryTripletexAction,
  saveTripletexSettingsAction,
  startTripletexAction,
} from "./actions";

export const metadata: Metadata = { title: "Tripletex" };

const card = "rounded-lg border border-line bg-card p-5";
const field = "min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";

/** The accounts that would take a question's bucket (or be the receivable), as Tripletex's own chart says. */
function optionsFor(problem: SettingsProblem, chart: Chart): { number: number; name: string }[] {
  if (problem.key === "receivable") return chart.accounts.filter((a) => receivableProblem(a) === null).slice(0, 50);
  const code = problem.vatCode ?? DEFAULT_BOOKING[problem.key].vatCode;
  const vat = chart.vatTypes.find((v) => v.number.trim() === code);
  if (!vat) return [];
  const [low, high] = problem.key === "gift_card" ? [2000, 2999] : [3000, 3999];
  return chart.accounts.filter((a) => a.number >= low && a.number <= high && bookingProblem(a, vat) === null).slice(0, 50);
}

/**
 * Tripletex (D453): Homer connects with one paste and presses Start; afterwards the card says how it goes and speaks up only when
 * something needs him. Lisa's every account, VAT code, start day and switch is behind Customise. Owners act; other members see.
 */
export default async function TripletexPage({ params }: PageProps<"/admin/[store]/integrations/tripletex">) {
  const { store: slug } = await params;
  const current = await requirePermission(slug, "settings:read");
  const { store } = current;
  const lang = adminLangOf(current.account.adminLocale);
  const w = adminText(lang, "notifications").integrations.tripletex;
  const owner = memberCan(current, "owner");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { dateStyle: "long", timeZone: "UTC" });

  const connection = await getTripletexConnection(store.id);
  const [counts, problems] = connection ? await Promise.all([tripletexCounts(store.id), tripletexProblems(store.id)]) : [null, []];
  // Before Start, the settings are checked against the company as it is now, so the owner is asked only what Tripletex would refuse.
  const check = connection?.state === "setup" && connection.settings && owner ? await checkTripletexSettings(store.id, connection.settings) : null;
  const questions = check?.ok ? check.problems : [];
  const today = todayIn(new Date(), store.timeZone);
  const ours = norwegianOrgNumber(connection ? await storeOrgNumber(store.id) : null);
  const theirs = norwegianOrgNumber(connection?.company.organizationNumber);
  const needYou = (counts?.blocked ?? 0) + (counts?.failed ?? 0);

  const connectForm = (
    <ActionForm action={connectTripletexAction.bind(null, store.slug)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 text-sm font-medium">
        <label htmlFor="tripletex-token">{w.token}</label>
        <input id="tripletex-token" name="token" type="password" autoComplete="off" spellCheck={false} required aria-describedby="tripletex-token-hint" className={`${field} font-mono`} />
        <p id="tripletex-token-hint" className="font-normal text-muted">
          {w.tokenHint}
        </p>
      </div>
      <div>
        <SubmitButton>{w.connect}</SubmitButton>
      </div>
    </ActionForm>
  );

  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
      <div className="flex flex-col gap-6">
        <div>
          <Link href={`/admin/${store.slug}/integrations`} className="text-sm underline">
            {w.back}
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <IntegrationMark id="tripletex" />
            <PageHeader
              title={<>Tripletex</>}
              description={<>{connection ? fillWords(w.connectedTo, { company: connection.company.name }) : w.summary}</>}
            />
          </div>
        </div>

        {!connection &&
          (owner ? (
            <section aria-labelledby="tripletex-connect" className={card}>
              <h2 id="tripletex-connect" className="mb-1 text-title text-ink">
                {w.connectTitle}
              </h2>
              <p className="mb-3 text-sm text-muted">{w.connectLead}</p>
              <ol className="mb-3 flex list-decimal flex-col gap-1 pl-5 text-sm">
                {w.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="mb-4 text-sm text-muted">{w.noApp}</p>
              {connectForm}
              <p className="mt-3 text-sm text-muted">{w.connectAfter}</p>
            </section>
          ) : (
            <p className="text-sm">{w.ownerOnly}</p>
          ))}

        {connection && (
          <section aria-labelledby="tripletex-company" className={card}>
            <h2 id="tripletex-company" className="mb-1 text-title text-ink">
              {fillWords(w.connectedTo, { company: connection.company.name })}
            </h2>
            {theirs && <p className="text-sm text-muted">{fillWords(w.orgNumber, { number: theirs })}</p>}
            {connection.mode === "test" && <p className="mt-2 text-sm text-muted">{w.testCompany}</p>}
            {ours && theirs && ours !== theirs && (
              <p role="alert" className="mt-3 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning-text">
                {fillWords(w.otherOrganisation, { ours })}
              </p>
            )}
          </section>
        )}

        {connection?.state === "auth_failed" && (
          <section aria-labelledby="tripletex-auth" className={card}>
            <h2 id="tripletex-auth" className="mb-1 text-title text-ink">
              {w.statusAuth}
            </h2>
            <p className="mb-4 text-sm text-muted">{w.authLead}</p>
            {owner ? connectForm : <p className="text-sm">{w.ownerOnly}</p>}
          </section>
        )}

        {connection?.state === "setup" && owner && (
          <section aria-labelledby="tripletex-ready" className={card}>
            {check && !check.ok && (
              <p role="alert" className="mb-4 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning-text">
                {fillWords(w.cannotCheck, { problem: failureWords({ key: check.failureKey, class: "transient" }, w.failures) })}
              </p>
            )}
            {questions.length > 0 && check?.ok ? (
              <>
                <h2 id="tripletex-ready" className="mb-1 text-title text-ink">
                  {countWords(questions.length, w.choose)}
                </h2>
                <p className="mb-4 text-sm text-muted">{w.chooseLead}</p>
                <ul className="flex flex-col gap-4">
                  {questions.map((q) => {
                    const options = optionsFor(q, check.chart);
                    const label = q.key === "receivable" ? w.receivable : w.buckets[q.key];
                    return (
                      <li key={q.key} className="flex flex-col gap-2 text-sm">
                        <span className="font-medium">{label}</span>
                        <span className="text-muted">{w.problemWords[q.problem]}</span>
                        {options.length > 0 ? (
                          <ActionForm action={chooseAccountAction.bind(null, store.slug, q.key)} className="flex flex-wrap items-end gap-2">
                            <label className="sr-only" htmlFor={`choose-${q.key}`}>
                              {label}
                            </label>
                            <select id={`choose-${q.key}`} name="account" className={field} defaultValue={String(options[0].number)}>
                              {options.map((o) => (
                                <option key={o.number} value={o.number}>
                                  {o.number} {o.name}
                                </option>
                              ))}
                            </select>
                            <SubmitButton variant="secondary">{w.useAccount}</SubmitButton>
                          </ActionForm>
                        ) : (
                          <span>{w.noAccountFits}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-4">
                  <Link href={`/admin/${store.slug}/integrations/tripletex`} className="text-sm underline">
                    {w.checkAgain}
                  </Link>
                </div>
              </>
            ) : (
              <>
                <h2 id="tripletex-ready" className="mb-1 text-title text-ink">
                  {w.readyTitle}
                </h2>
                <p className="mb-4 text-sm text-muted">{fillWords(w.readyLead, { date: day(today) })}</p>
                <ActionForm action={startTripletexAction.bind(null, store.slug)} className="flex flex-col gap-3">
                  <div>
                    <SubmitButton>{w.start}</SubmitButton>
                  </div>
                </ActionForm>
              </>
            )}
          </section>
        )}

        {connection && (connection.state === "on" || connection.state === "paused") && counts && (
          <section aria-labelledby="tripletex-status" className={card}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 id="tripletex-status" className="text-title text-ink">
                {connection.state === "on" ? w.statusOn : w.statusPaused}
              </h2>
              {connection.state === "on" && (
                <Chip signal={needYou > 0 ? "warning" : "positive"} dot>
                  {needYou > 0 ? countWords(needYou, w.needYou) : w.allFine}
                </Chip>
              )}
            </div>
            <p className="text-sm">
              {countWords(counts.lastWeek, w.sentWeek)}
              {counts.waiting > 0 && <> · {countWords(counts.waiting, w.waiting)}</>}
            </p>
            {connection.lastOkAt && <p className="mt-1 text-sm text-muted">{fillWords(w.lastContact, { when: when(connection.lastOkAt) })}</p>}
            {owner && (
              <div className="mt-4 flex flex-wrap gap-2">
                {/* Here, not in "Needs you": that list goes when nothing waits, and the answer must stay to be read. */}
                {problems.length > 0 && (
                  <ActionForm action={retryTripletexAction.bind(null, store.slug)}>
                    <SubmitButton>{w.tryAgain}</SubmitButton>
                  </ActionForm>
                )}
                {connection.state === "on" ? (
                  <ActionForm action={pauseTripletexAction.bind(null, store.slug)}>
                    <SubmitButton variant="secondary">{w.pause}</SubmitButton>
                  </ActionForm>
                ) : (
                  <ActionForm action={startTripletexAction.bind(null, store.slug)}>
                    <SubmitButton>{w.resume}</SubmitButton>
                  </ActionForm>
                )}
              </div>
            )}
          </section>
        )}

        {connection && problems.length > 0 && (
          <section aria-labelledby="tripletex-problems" className={card}>
            <h2 id="tripletex-problems" className="mb-3 text-title text-ink">
              {w.problemsTitle}
            </h2>
            <List label={w.problemsTitle}>
              {problems.map((p) => {
                const key = p.errorKey ?? "rule";
                const reason = key in w.blocks ? w.blocks[key as keyof typeof w.blocks] : failureWords({ key, class: p.state === "failed" ? "transient" : "rule" }, w.failures);
                return (
                  <ListRow key={`${p.kind}:${p.localId}`}>
                    <RowLead
                      title={fillWords(w.documents[p.kind], { number: p.number ?? "" }).trim()}
                      sub={
                        <>
                          {reason}
                          {p.detail && <span className="block">{fillWords(w.tripletexSaid, { detail: p.detail })}</span>}
                        </>
                      }
                    />
                    <RowDate>{when(p.at)}</RowDate>
                  </ListRow>
                );
              })}
            </List>
          </section>
        )}

        {connection?.settings && (
          <section aria-labelledby="tripletex-booked" className={card}>
            <h2 id="tripletex-booked" className="mb-1 text-title text-ink">
              {w.bookedWhere}
            </h2>
            <p className="mb-3 text-sm text-muted">{w.bookedHint}</p>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
              {BOOKING_KEYS.filter((key) => connection.settings!.bookings[key]).map((key) => (
                <div key={key} className="contents">
                  <dt>{w.buckets[key]}</dt>
                  <dd className="text-muted">{fillWords(w.accountCode, { account: connection.settings!.bookings[key]!.account, code: connection.settings!.bookings[key]!.vatCode })}</dd>
                </div>
              ))}
              <div className="contents">
                <dt>{w.receivable}</dt>
                <dd className="text-muted">{fillWords(w.account, { account: connection.settings.receivableAccount })}</dd>
              </div>
            </dl>
          </section>
        )}

        {connection?.settings && owner && (
          <details className={card}>
            <summary className="cursor-pointer text-title text-ink">{w.customise}</summary>
            <p className="mt-2 mb-4 text-sm text-muted">{w.customiseLead}</p>
            <ActionForm action={saveTripletexSettingsAction.bind(null, store.slug)} className="flex flex-col gap-5">
              <fieldset className="flex flex-col gap-3">
                {/* The columns' names once on a wide screen; on a phone each pair carries its own. */}
                <div aria-hidden className="hidden text-sm text-muted sm:grid sm:grid-cols-[minmax(0,1fr)_8rem_6rem] sm:gap-2">
                  <span />
                  <span>{w.accountLabel}</span>
                  <span>{w.vatLabel}</span>
                </div>
                {BOOKING_KEYS.map((key: BookingKey) => {
                  const booking = connection.settings!.bookings[key];
                  return (
                    <div key={key} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_8rem_6rem] sm:items-center">
                      <span className="col-span-2 font-medium sm:col-span-1">{w.buckets[key]}</span>
                      <label className="flex flex-col gap-1">
                        <span className="text-muted sm:sr-only">{w.accountLabel}</span>
                        <input name={`account_${key}`} inputMode="numeric" pattern="[0-9]{4,5}" defaultValue={booking ? String(booking.account) : ""} className={field} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-muted sm:sr-only">{w.vatLabel}</span>
                        <input name={`vat_${key}`} inputMode="numeric" pattern="[0-9]{1,3}" defaultValue={booking?.vatCode ?? ""} className={field} />
                      </label>
                    </div>
                  );
                })}
              </fieldset>
              <label className="flex flex-col gap-1 text-sm font-medium">
                {w.receivableLabel}
                <input name="receivable" inputMode="numeric" pattern="[0-9]{4,5}" required defaultValue={String(connection.settings.receivableAccount)} className={`${field} max-w-40`} />
              </label>
              {connection.state !== "setup" && (
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {w.syncFrom}
                  <input name="syncFrom" type="date" max={today} defaultValue={connection.syncFrom ?? today} className={`${field} max-w-48`} />
                  <span className="font-normal text-muted">{w.syncFromHint}</span>
                </label>
              )}
              <fieldset className="flex flex-col gap-2 text-sm">
                <legend className="mb-1 font-medium">{w.sources}</legend>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="sourceWork" defaultChecked={connection.settings.sources.work} className="size-4" />
                  {w.sourceWork}
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="sourceShop" defaultChecked={connection.settings.sources.shop} className="size-4" />
                  {w.sourceShop}
                </label>
              </fieldset>
              <label className="flex flex-col gap-1 text-sm font-medium">
                {w.language}
                <select name="language" defaultValue={connection.settings.language} className={`${field} max-w-48`}>
                  <option value="nb">{w.languages.nb}</option>
                  <option value="en">{w.languages.en}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="sendContactEmail" defaultChecked={connection.settings.sendContactEmail} className="size-4" />
                {w.sendEmail}
              </label>
              <div>
                <SubmitButton>{w.save}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        )}

        {connection && owner && (
          <DeleteDiscountButton action={disconnectTripletexAction.bind(null, store.slug)} code="Tripletex" question={w.disconnectQuestion} label={w.disconnect} />
        )}
      </div>
    </AdminTextScope>
  );
}
