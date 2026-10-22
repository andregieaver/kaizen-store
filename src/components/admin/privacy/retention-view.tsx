import type { FormState } from "@/components/admin/action-form";
import { PERSONAL_DATA } from "@/lib/personal-data";
import { countWords, fillWords } from "@/lib/admin-fill";
import { privacyEn, type PrivacyMessages } from "@/lib/admin-messages/privacy.en";
import { isBookkeepingKind, RETENTION_KINDS, type Period, type RetentionKind } from "@/lib/retention";
import type { RetentionOverview, StoredRule } from "@/server/retention";
import { PageHeader } from "@/components/admin/ui";

import { ChangeRuleForm } from "./retention-forms";
import { StepForm } from "./request-actions";
import { alertText, card, dayText } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export const KIND_LABELS: Record<RetentionKind, string> = privacyEn.retention.kinds;

/** What a rule row says in one line in the admin's language, as `describePeriod()` writes it in English. */
export function periodText(p: Period, w: PrivacyMessages["retention"]["period"] = privacyEn.retention.period): string {
  if (p.periodUnit === "months" && p.periodValue % 12 === 0) {
    const base = countWords(p.periodValue / 12, w.years);
    return p.countsFrom === "end_of_year" ? fillWords(w.fromYearEnd, { period: base }) : base;
  }
  return countWords(p.periodValue, p.periodUnit === "months" ? w.months : w.days);
}

/** A period that is set by a constant in code: the row describes it, and a test holds the two equal. A change here would not change what is enforced. */
export const setInCode = (rule: Pick<StoredRule, "note">): boolean => /constant is the source/i.test(rule.note);

const countryText = (country: string | null, w: PrivacyMessages["retention"]) => (country ? country : w.everyOtherCountry);

function RuleRow({
  rule,
  verify,
  w,
  day,
}: {
  rule: StoredRule;
  verify: (id: string) => Action;
  w: PrivacyMessages["retention"];
  day: (value: string | null) => string;
}) {
  return (
    <tr className="border-t border-line align-top">
      <td className="py-2 pr-3">{countryText(rule.country, w)}</td>
      <td className="py-2 pr-3 whitespace-nowrap">
        {periodText(rule, w.period)}
        {setInCode(rule) && <span className="block text-xs text-muted">{w.setInCode}</span>}
      </td>
      <td className="py-2 pr-3">
        <span className="block">{w.bases[rule.basis]}</span>
        <span className="block text-xs text-muted">
          {rule.sourceUrl && /^https?:\/\//i.test(rule.sourceUrl) ? (
            <a href={rule.sourceUrl} target="_blank" rel="noreferrer" className="break-all underline">
              {rule.source}
            </a>
          ) : (
            rule.source
          )}
        </span>
        <span className="block text-xs text-muted">{fillWords(w.checked, { checked: day(rule.checkedOn), from: day(rule.validFrom) })}</span>
      </td>
      <td className="py-2">
        {rule.verifiedAt ? (
          <span>{fillWords(w.reviewed, { date: day(rule.verifiedAt) })}</span>
        ) : (
          <div className="flex flex-col gap-2">
            <span className={`text-xs font-medium ${alertText}`}>{w.notReviewed}</span>
            <StepForm action={verify(rule.id)} successMessage={w.markedReviewed}>
              {w.markReviewed}
            </StepForm>
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * The retention schedule for the platform's admin (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.5): for each kind of data how long it is kept,
 * where the period comes from (and how much of the source was read), whether a person has reviewed it, and the daily job's last results.
 * A period is never edited in place: a change starts a new row and ends the old one. Every bookkeeping period is for an accountant to
 * review; the page says so and does not call anything legal advice.
 */
export function RetentionView({
  overview,
  verify,
  change,
  today,
  words = privacyEn,
  locale = "en-GB",
}: {
  overview: RetentionOverview;
  /** `(ruleId) => action` */
  verify: (id: string) => Action;
  change: Action;
  today: string;
  /** The privacy screens' words in the admin's language, and its date locale. */
  words?: PrivacyMessages;
  locale?: string;
}) {
  const w = words.retention;
  const day = (value: string | null) => dayText(value, undefined, locale);
  const current = overview.rules.filter((r) => r.validTo === null);
  const history = overview.rules.filter((r) => r.validTo !== null);
  const byKind = new Map<RetentionKind, StoredRule[]>();
  for (const r of current) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  const personal = PERSONAL_DATA.filter((e) => e.subject === "shopper");
  const actions = (a: string) => personal.filter((e) => e.erasure === a).length;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={<>{w.description}</>} />

      <section aria-labelledby="unreviewed" className={card}>
        <h2 id="unreviewed" className="text-title text-ink">
          {w.unreviewedTitle}
        </h2>
        {overview.unverified === 0 ? (
          <p className="text-sm text-muted">{w.allReviewed}</p>
        ) : (
          <p className="text-sm" aria-live="polite">
            {countWords(overview.unverified, w.unreviewed)}
          </p>
        )}
      </section>

      {RETENTION_KINDS.filter((kind) => byKind.has(kind)).map((kind) => (
        <section key={kind} aria-labelledby={`kind-${kind}`} className={card}>
          <div>
            <h2 id={`kind-${kind}`} className="text-title text-ink">
              {w.kinds[kind]}
            </h2>
            {isBookkeepingKind(kind) && <p className="text-sm text-muted">{w.floor}</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">{fillWords(w.inForce, { kind: w.kinds[kind] })}</caption>
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {w.country}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {w.kept}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {w.source}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    {w.review}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(byKind.get(kind) ?? []).map((rule) => (
                  <RuleRow key={rule.id} rule={rule} verify={verify} w={w} day={day} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section aria-labelledby="change-rule" className={card}>
        <h2 id="change-rule" className="text-title text-ink">
          {w.changeTitle}
        </h2>
        <p className="text-sm text-muted">{w.changeText}</p>
        <ChangeRuleForm action={change} today={today} kinds={RETENTION_KINDS.map((k) => ({ value: k, label: w.kinds[k] }))} />
      </section>

      <section aria-labelledby="register" className={card}>
        <h2 id="register" className="text-title text-ink">
          {w.registerTitle}
        </h2>
        <p className="text-sm text-muted">{w.registerText}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {(
            [
              ["delete", words.plan.actions.deleted],
              ["anonymise", words.plan.actions.anonymised],
              ["restrict", words.plan.actions.restricted],
              ["keep", words.plan.actions.kept],
            ] as const
          ).map(([key, text]) => (
            <div key={key} className="rounded-panel border border-line p-3">
              <dt className="text-muted">{text}</dt>
              <dd className="text-xl font-medium">{actions(key)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="runs" className={card}>
        <h2 id="runs" className="text-title text-ink">
          {w.jobTitle}
        </h2>
        {overview.lastRuns.length === 0 ? (
          <p className="text-sm text-muted">{w.jobNotRun}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">{w.runsCaption}</caption>
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {w.ran}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    {w.ordersAnonymised}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    {w.rowsRemoved}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    {w.problems}
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.lastRuns.map((run) => {
                  const removed = Object.entries(run.counts)
                    .filter(([k]) => k !== "orders")
                    .reduce((sum, [, n]) => sum + n, 0);
                  return (
                    <tr key={run.at} className="border-t border-line">
                      <td className="py-2 pr-3 whitespace-nowrap">{day(run.at.slice(0, 10))}</td>
                      <td className="py-2 pr-3 text-right">{run.counts.orders ?? 0}</td>
                      <td className="py-2 pr-3 text-right">{removed}</td>
                      <td className="py-2">
                        {run.errors > 0 ? <span className={alertText}>{countWords(run.errors, w.stepsFailed)}</span> : w.none}
                        {run.filesLeft > 0 && <span className="block text-xs text-muted">{fillWords(w.filesLeft, { n: run.filesLeft })}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section aria-labelledby="history" className={card}>
          <h2 id="history" className="text-title text-ink">
            {w.earlier}
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {history.map((r) => (
              <li key={r.id}>
                {fillWords(w.earlierRow, {
                  kind: w.kinds[r.kind],
                  country: countryText(r.country, w),
                  period: periodText(r, w.period),
                  from: day(r.validFrom),
                  to: day(r.validTo),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
