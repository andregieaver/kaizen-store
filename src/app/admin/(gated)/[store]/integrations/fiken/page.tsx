import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { IntegrationMark } from "@/components/admin/integration-mark";
import { Chip, List, ListRow, PageHeader, RowDate, RowLead } from "@/components/admin/ui";
import { BOOKING_KEYS, norwegianOrgNumber } from "@/lib/accounting-docs";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { todayIn } from "@/lib/analytics-period";
import { fikenFailureWords } from "@/lib/fiken-errors";
import { FIKEN_SALE_VAT_TYPES } from "@/lib/fiken-settings";
import { fikenOptionsFor } from "@/lib/fiken-setup";
import { storeOrgNumber } from "@/server/accounting-documents";
import { checkFikenSettingsNow, fikenCompanies, fikenCounts, fikenOffered, fikenProblems, getFikenConnection } from "@/server/fiken";
import { memberCan, requirePermission } from "@/server/permissions";
import { getTripletexConnection } from "@/server/tripletex";

import {
  chooseCompanyAction,
  chooseFikenAccountAction,
  connectFikenAction,
  disconnectFikenAction,
  pauseFikenAction,
  postFikenAgainAction,
  retryFikenAction,
  saveFikenSettingsAction,
  startFikenAction,
} from "./actions";

export const metadata: Metadata = { title: "Fiken" };

const card = "rounded-lg border border-line bg-card p-5";
const field = "min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";

const OUTCOMES = ["connected", "choose", "declined", "failed", "other_system", "no_company", "taken"] as const;

/**
 * Fiken (D460): Homer presses Connect Fiken, allows Kaizena Flow on Fiken's own page, and presses Start; afterwards the card says how it
 * goes and speaks up only when something needs him. Lisa's every account, VAT type, start day and switch is behind Customise. Owners act;
 * other members see.
 */
export default async function FikenPage({ params, searchParams }: PageProps<"/admin/[store]/integrations/fiken">) {
  const { store: slug } = await params;
  const query = await searchParams;
  const current = await requirePermission(slug, "settings:read");
  const { store } = current;
  const lang = adminLangOf(current.account.adminLocale);
  const w = adminText(lang, "fiken");
  const owner = memberCan(current, "owner");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { dateStyle: "long", timeZone: "UTC" });
  const outcome = OUTCOMES.find((o) => o === query.fiken);

  const connection = await getFikenConnection(store.id);
  const tripletex = connection ? null : await getTripletexConnection(store.id);
  const [counts, problems] = connection?.company ? await Promise.all([fikenCounts(store.id), fikenProblems(store.id)]) : [null, []];
  const companies = connection?.state === "choose" && owner ? await fikenCompanies(store.id) : [];
  // Before Start, the settings are checked against the company as it is now, so the owner is asked only what Fiken would refuse.
  const check = connection?.state === "setup" && connection.settings && owner ? await checkFikenSettingsNow(store.id, connection.settings) : null;
  const questions = check?.ok ? check.problems : [];
  const today = todayIn(new Date(), store.timeZone);
  const ours = norwegianOrgNumber(connection?.company ? await storeOrgNumber(store.id) : null);
  const theirs = norwegianOrgNumber(connection?.company?.organizationNumber);
  const needYou = (counts?.blocked ?? 0) + (counts?.failed ?? 0);
  const offered = fikenOffered();

  const connectButton = (label: string) => (
    <ActionForm action={connectFikenAction.bind(null, store.slug)}>
      <SubmitButton>{label}</SubmitButton>
    </ActionForm>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/integrations`} className="text-sm underline">
          {w.back}
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <IntegrationMark id="fiken" />
          <PageHeader title={<>Fiken</>} description={<>{connection?.company ? fillWords(w.connectedTo, { company: connection.company.name }) : w.summary}</>} />
        </div>
      </div>

      {outcome && (
        <p role={outcome === "connected" || outcome === "choose" ? "status" : "alert"} className={`rounded-md px-4 py-3 text-sm ${outcome === "connected" || outcome === "choose" ? "bg-positive-soft text-positive-text" : "bg-warning-soft text-warning-text"}`}>
          {w.outcomes[outcome]}
        </p>
      )}

      {!connection &&
        (!owner ? (
          <p className="text-sm">{w.ownerOnly}</p>
        ) : tripletex ? (
          <p className="text-sm">{w.connectProblems.other_system}</p>
        ) : !offered ? (
          <p className="text-sm text-muted">{w.offline}</p>
        ) : (
          <section aria-labelledby="fiken-connect" className={card}>
            <h2 id="fiken-connect" className="mb-1 text-title text-ink">
              {w.connectTitle}
            </h2>
            <p className="mb-3 text-sm text-muted">{w.connectLead}</p>
            <ol className="mb-4 flex list-decimal flex-col gap-1 pl-5 text-sm">
              {w.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {connectButton(w.connect)}
            <p className="mt-3 text-sm text-muted">{w.connectAfter}</p>
          </section>
        ))}

      {connection?.state === "choose" && owner && (
        <section aria-labelledby="fiken-choose" className={card}>
          <h2 id="fiken-choose" className="mb-1 text-title text-ink">
            {w.chooseTitle}
          </h2>
          <p className="mb-4 text-sm text-muted">{w.chooseLead}</p>
          {companies.length === 0 ? (
            <>
              <p className="mb-4 text-sm">{w.noCompanies}</p>
              {offered && connectButton(w.reconnect)}
            </>
          ) : (
            <ul className="flex flex-col gap-3">
              {companies.map((company) => (
                <li key={company.slug} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="font-medium">{company.name}</span>
                    {company.organizationNumber && <span className="text-muted"> · {company.organizationNumber}</span>}
                    {company.testCompany && <span className="text-muted"> · {w.testCompanyTag}</span>}
                    {!company.hasApiAccess && <span className="text-muted"> · {w.noApiAccess}</span>}
                  </span>
                  <ActionForm action={chooseCompanyAction.bind(null, store.slug, company.slug)}>
                    <SubmitButton variant="secondary">{w.chooseCompany}</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {connection?.company && (
        <section aria-labelledby="fiken-company" className={card}>
          <h2 id="fiken-company" className="mb-1 text-title text-ink">
            {fillWords(w.connectedTo, { company: connection.company.name })}
          </h2>
          {theirs && <p className="text-sm text-muted">{fillWords(w.orgNumber, { number: theirs })}</p>}
          {connection.testCompany && <p className="mt-2 text-sm text-muted">{w.testCompany}</p>}
          {ours && theirs && ours !== theirs && (
            <p role="alert" className="mt-3 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning-text">
              {fillWords(w.otherOrganisation, { ours })}
            </p>
          )}
        </section>
      )}

      {connection?.state === "auth_failed" && (
        <section aria-labelledby="fiken-auth" className={card}>
          <h2 id="fiken-auth" className="mb-1 text-title text-ink">
            {w.statusAuth}
          </h2>
          <p className="mb-4 text-sm text-muted">{w.authLead}</p>
          {owner ? offered && connectButton(w.reconnect) : <p className="text-sm">{w.ownerOnly}</p>}
        </section>
      )}

      {connection?.state === "setup" && owner && (
        <section aria-labelledby="fiken-ready" className={card}>
          {check && !check.ok && (
            <p role="alert" className="mb-4 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning-text">
              {fillWords(w.cannotCheck, { problem: fikenFailureWords({ key: check.failureKey, class: "transient" }, w.failures) })}
            </p>
          )}
          {questions.length > 0 && check?.ok ? (
            <>
              <h2 id="fiken-ready" className="mb-1 text-title text-ink">
                {countWords(questions.length, w.choose)}
              </h2>
              <p className="mb-4 text-sm text-muted">{w.chooseAccountLead}</p>
              <ul className="flex flex-col gap-4">
                {questions.map((q) => {
                  const options = fikenOptionsFor(q.key, check.accounts).slice(0, 50);
                  return (
                    <li key={q.key} className="flex flex-col gap-2 text-sm">
                      <span className="font-medium">{w.buckets[q.key]}</span>
                      <span className="text-muted">{w.problemWords[q.problem]}</span>
                      {options.length > 0 ? (
                        <ActionForm action={chooseFikenAccountAction.bind(null, store.slug, q.key)} className="flex flex-wrap items-end gap-2">
                          <label className="sr-only" htmlFor={`choose-${q.key}`}>
                            {w.buckets[q.key]}
                          </label>
                          <select id={`choose-${q.key}`} name="account" className={field} defaultValue={options[0].code}>
                            {options.map((o) => (
                              <option key={o.code} value={o.code}>
                                {o.code} {o.name}
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
                <Link href={`/admin/${store.slug}/integrations/fiken`} className="text-sm underline">
                  {w.checkAgain}
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2 id="fiken-ready" className="mb-1 text-title text-ink">
                {w.readyTitle}
              </h2>
              <p className="mb-4 text-sm text-muted">{fillWords(w.readyLead, { date: day(today) })}</p>
              <ActionForm action={startFikenAction.bind(null, store.slug)}>
                <SubmitButton>{w.start}</SubmitButton>
              </ActionForm>
            </>
          )}
        </section>
      )}

      {connection && (connection.state === "on" || connection.state === "paused") && counts && (
        <section aria-labelledby="fiken-status" className={card}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 id="fiken-status" className="text-title text-ink">
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
              {problems.length > 0 && (
                <ActionForm action={retryFikenAction.bind(null, store.slug)}>
                  <SubmitButton>{w.tryAgain}</SubmitButton>
                </ActionForm>
              )}
              {connection.state === "on" ? (
                <ActionForm action={pauseFikenAction.bind(null, store.slug)}>
                  <SubmitButton variant="secondary">{w.pause}</SubmitButton>
                </ActionForm>
              ) : (
                <ActionForm action={startFikenAction.bind(null, store.slug)}>
                  <SubmitButton>{w.resume}</SubmitButton>
                </ActionForm>
              )}
            </div>
          )}
        </section>
      )}

      {connection && problems.length > 0 && (
        <section aria-labelledby="fiken-problems" className={card}>
          <h2 id="fiken-problems" className="mb-3 text-title text-ink">
            {w.problemsTitle}
          </h2>
          <List label={w.problemsTitle}>
            {problems.map((p) => {
              const key = p.errorKey ?? "rule";
              const reason = key in w.blocks ? w.blocks[key as keyof typeof w.blocks] : fikenFailureWords({ key, class: p.state === "failed" ? "transient" : "rule" }, w.failures);
              return (
                <ListRow key={`${p.kind}:${p.localId}`}>
                  <RowLead
                    title={fillWords(w.documents[p.kind], { number: p.number ?? "" }).trim()}
                    sub={
                      <>
                        {reason}
                        {p.detail && <span className="block">{fillWords(w.fikenSaid, { detail: p.detail })}</span>}
                        {/* A sale deleted in Fiken is never booked again on its own: Post again is the owner's choice. */}
                        {owner && p.state === "drifted" && (
                          <ActionForm action={postFikenAgainAction.bind(null, store.slug, p.kind, p.localId)} className="mt-2">
                            <SubmitButton variant="secondary">{w.postAgain}</SubmitButton>
                          </ActionForm>
                        )}
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

      {connection?.company && connection.settings && (
        <section aria-labelledby="fiken-booked" className={card}>
          <h2 id="fiken-booked" className="mb-1 text-title text-ink">
            {w.bookedWhere}
          </h2>
          <p className="mb-3 text-sm text-muted">{w.bookedHint}</p>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
            {BOOKING_KEYS.filter((key) => connection.settings!.bookings[key]).map((key) => (
              <div key={key} className="contents">
                <dt>{w.buckets[key]}</dt>
                <dd className="text-muted">{fillWords(w.accountVat, { account: connection.settings!.bookings[key]!.account, vat: w.vatTypes[connection.settings!.bookings[key]!.vatType] })}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {connection?.company && connection.settings && owner && (
        <details className={card}>
          <summary className="cursor-pointer text-title text-ink">{w.customise}</summary>
          <p className="mt-2 mb-4 text-sm text-muted">{w.customiseLead}</p>
          <ActionForm action={saveFikenSettingsAction.bind(null, store.slug)} className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-3">
              {/* The columns' names once on a wide screen; on a phone each pair carries its own. */}
              <div aria-hidden className="hidden text-sm text-muted sm:grid sm:grid-cols-[minmax(0,1fr)_6rem_14rem] sm:gap-2">
                <span />
                <span>{w.accountLabel}</span>
                <span>{w.vatLabel}</span>
              </div>
              {BOOKING_KEYS.map((key) => {
                const booking = connection.settings!.bookings[key];
                return (
                  <div key={key} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_6rem_14rem] sm:items-center">
                    <span className="col-span-2 font-medium sm:col-span-1">{w.buckets[key]}</span>
                    <label className="flex flex-col gap-1">
                      <span className="text-muted sm:sr-only">{w.accountLabel}</span>
                      <input name={`account_${key}`} inputMode="numeric" pattern="[0-9]{4}" defaultValue={booking?.account ?? ""} placeholder={w.notUsed} className={field} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-muted sm:sr-only">{w.vatLabel}</span>
                      <select name={`vat_${key}`} defaultValue={booking?.vatType ?? "HIGH"} className={field}>
                        {FIKEN_SALE_VAT_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {w.vatTypes[type]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                );
              })}
            </fieldset>
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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="attachPdf" defaultChecked={connection.settings.attachPdf} className="size-4" />
              {w.attachPdf}
            </label>
            <div>
              <SubmitButton>{w.save}</SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}

      {connection && owner && <DeleteDiscountButton action={disconnectFikenAction.bind(null, store.slug)} code="Fiken" question={w.disconnectQuestion} label={w.disconnect} />}
    </div>
  );
}
