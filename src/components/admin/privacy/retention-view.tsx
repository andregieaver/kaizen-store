import type { FormState } from "@/components/admin/action-form";
import { PERSONAL_DATA } from "@/lib/personal-data";
import { describePeriod, isBookkeepingKind, RETENTION_KINDS, type RetentionBasis, type RetentionKind } from "@/lib/retention";
import type { RetentionOverview, StoredRule } from "@/server/retention";

import { ChangeRuleForm } from "./retention-forms";
import { StepForm } from "./request-actions";
import { alertText, card, dayText } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export const KIND_LABELS: Record<RetentionKind, string> = {
  bookkeeping: "Orders, invoices and payments (bookkeeping)",
  host_bookkeeping: "Hosts' orders (bookkeeping)",
  unpaid_orders: "Orders never paid",
  email_bodies: "Sent emails (the text and recipients)",
  security_emails: "Sign-in and password emails",
  carts: "Carts",
  delivery_quotes: "Delivery quotes",
  customer_codes: "Sign-in codes",
  customer_sessions: "Signed-in browsers",
  webhook_payloads: "Payment provider events",
  consents: "Cookie consent log",
  privacy_request_contact: "Email on a finished privacy request",
  privacy_requests: "The privacy request log",
  search_queries: "Search log",
  visits: "Visit counts",
  audit_log: "Activity log",
  form_submissions: "Form submissions",
  integration_deliveries: "Integration deliveries",
  abandoned_checkouts: "Abandoned checkouts",
  recommendation_events: "Recommendation events",
  ai_usage: "AI usage log",
};

const BASIS_WORDS: Record<RetentionBasis, string> = {
  read: "Read at the source",
  snippet: "Seen in a search result only",
  secondary: "From a secondary source",
  fallback: "Safe fallback, not read",
  policy: "Kaizen's own choice",
};

/** A period that is set by a constant in code: the row describes it, and a test holds the two equal. A change here would not change what is enforced. */
export const setInCode = (rule: Pick<StoredRule, "note">): boolean => /constant is the source/i.test(rule.note);

const countryText = (country: string | null) => (country ? country : "Every other country");

function RuleRow({ rule, verify }: { rule: StoredRule; verify: (id: string) => Action }) {
  return (
    <tr className="border-t border-border align-top">
      <td className="py-2 pr-3">{countryText(rule.country)}</td>
      <td className="py-2 pr-3 whitespace-nowrap">
        {describePeriod(rule)}
        {setInCode(rule) && <span className="block text-xs text-muted">Set in code: a change here is only a record</span>}
      </td>
      <td className="py-2 pr-3">
        <span className="block">{BASIS_WORDS[rule.basis]}</span>
        <span className="block text-xs text-muted">
          {rule.sourceUrl && /^https?:\/\//i.test(rule.sourceUrl) ? (
            <a href={rule.sourceUrl} target="_blank" rel="noreferrer" className="break-all underline">
              {rule.source}
            </a>
          ) : (
            rule.source
          )}
        </span>
        <span className="block text-xs text-muted">Checked {dayText(rule.checkedOn)}; in force from {dayText(rule.validFrom)}</span>
      </td>
      <td className="py-2">
        {rule.verifiedAt ? (
          <span>Reviewed {dayText(rule.verifiedAt)}</span>
        ) : (
          <div className="flex flex-col gap-2">
            <span className={`text-xs font-medium ${alertText}`}>Not reviewed</span>
            <StepForm action={verify(rule.id)} successMessage="Marked as reviewed.">
              Mark reviewed
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
}: {
  overview: RetentionOverview;
  /** `(ruleId) => action` */
  verify: (id: string) => Action;
  change: Action;
  today: string;
}) {
  const current = overview.rules.filter((r) => r.validTo === null);
  const history = overview.rules.filter((r) => r.validTo !== null);
  const byKind = new Map<RetentionKind, StoredRule[]>();
  for (const r of current) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  const personal = PERSONAL_DATA.filter((e) => e.subject === "shopper");
  const actions = (a: string) => personal.filter((e) => e.erasure === a).length;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Data retention</h1>
        <p className="max-w-2xl text-sm text-muted">
          How long each kind of personal data is kept, and what the daily job removes when the time is up. Bookkeeping periods come from each country&apos;s law and need an accountant to review them;
          the rest are Kaizen&apos;s own choice. This is not legal advice.
        </p>
      </div>

      <section aria-labelledby="unreviewed" className={card}>
        <h2 id="unreviewed" className="font-medium">
          Not reviewed yet
        </h2>
        {overview.unverified === 0 ? (
          <p className="text-sm text-muted">Every period in force has been reviewed by a person.</p>
        ) : (
          <p className="text-sm" aria-live="polite">
            {overview.unverified} {overview.unverified === 1 ? "period is" : "periods are"} in force without a review. They are still the periods the job uses. Work through them with an accountant (the bookkeeping ones first) and mark each reviewed.
          </p>
        )}
      </section>

      {RETENTION_KINDS.filter((kind) => byKind.has(kind)).map((kind) => (
        <section key={kind} aria-labelledby={`kind-${kind}`} className={card}>
          <div>
            <h2 id={`kind-${kind}`} className="font-medium">
              {KIND_LABELS[kind]}
            </h2>
            {isBookkeepingKind(kind) && <p className="text-sm text-muted">The database refuses a bookkeeping period under five years. The financial year is counted as the calendar year.</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">{KIND_LABELS[kind]}: periods in force</caption>
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Country</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Kept</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Source</th>
                  <th scope="col" className="py-2 font-medium">Review</th>
                </tr>
              </thead>
              <tbody>
                {(byKind.get(kind) ?? []).map((rule) => (
                  <RuleRow key={rule.id} rule={rule} verify={verify} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section aria-labelledby="change-rule" className={card}>
        <h2 id="change-rule" className="font-medium">
          Change a period
        </h2>
        <p className="text-sm text-muted">
          A change ends the period in force and starts a new one from the date you give, and is written to the activity log. Periods marked &quot;Set in code&quot; are enforced by the application&apos;s own
          constants: a new row records the decision, but does not change what is removed.
        </p>
        <ChangeRuleForm action={change} today={today} kinds={RETENTION_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
      </section>

      <section aria-labelledby="register" className={card}>
        <h2 id="register" className="font-medium">
          The register of personal data
        </h2>
        <p className="text-sm text-muted">
          Every table that holds a shopper&apos;s data is listed in the register, with what erasure does to it. A test fails when a table with personal columns is added and not classified.
        </p>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {(
            [
              ["delete", "Deleted"],
              ["anonymise", "Made anonymous"],
              ["restrict", "Kept restricted"],
              ["keep", "Kept"],
            ] as const
          ).map(([key, text]) => (
            <div key={key} className="rounded-lg border border-border p-3">
              <dt className="text-muted">{text}</dt>
              <dd className="text-xl font-semibold">{actions(key)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="runs" className={card}>
        <h2 id="runs" className="font-medium">
          The daily job
        </h2>
        {overview.lastRuns.length === 0 ? (
          <p className="text-sm text-muted">The job has not run yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">The last runs of the retention job</caption>
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Ran</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Orders made anonymous</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Rows removed</th>
                  <th scope="col" className="py-2 font-medium">Problems</th>
                </tr>
              </thead>
              <tbody>
                {overview.lastRuns.map((run) => {
                  const removed = Object.entries(run.counts).filter(([k]) => k !== "orders").reduce((sum, [, n]) => sum + n, 0);
                  return (
                    <tr key={run.at} className="border-t border-border">
                      <td className="py-2 pr-3 whitespace-nowrap">{dayText(run.at.slice(0, 10))}</td>
                      <td className="py-2 pr-3 text-right">{run.counts.orders ?? 0}</td>
                      <td className="py-2 pr-3 text-right">{removed}</td>
                      <td className="py-2">
                        {run.errors > 0 ? <span className={alertText}>{run.errors} {run.errors === 1 ? "step failed" : "steps failed"}</span> : "None"}
                        {run.filesLeft > 0 && <span className="block text-xs text-muted">{run.filesLeft} files still to remove</span>}
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
          <h2 id="history" className="font-medium">
            Earlier periods
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {history.map((r) => (
              <li key={r.id}>
                {KIND_LABELS[r.kind]}, {countryText(r.country)}: {describePeriod(r)}, from {dayText(r.validFrom)} to {dayText(r.validTo)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
