import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { A11Y_STATUSES, A11Y_STATUS_WORDS, type A11yFacts, type A11ySettings, type EnforcementBody } from "@/lib/a11y-statement";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const field = "min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal";

/** What the site itself knows, in sentences: a count that cannot be known says so, never zero. */
export function factLines(facts: A11yFacts): string[] {
  const lines: string[] = [];
  lines.push(
    facts.themeWarnings === 0
      ? "The theme's colour pairs all reach the 4.5 to 1 contrast the standard asks for."
      : `${facts.themeWarnings} of the theme's colour pairs are below the 4.5 to 1 contrast the standard asks for (see Design).`,
  );
  lines.push(
    facts.mediaWithoutAlt === null
      ? "How many pictures lack alt text is not known."
      : facts.mediaWithoutAlt.total === 0
        ? "The media library holds no pictures yet."
        : `${facts.mediaWithoutAlt.missing} of ${facts.mediaWithoutAlt.total} pictures in the media library have no alt text.`,
  );
  lines.push(
    facts.pagesWithBlockingIssues === null
      ? "How many published pages have problems the page checker finds is not known."
      : facts.pagesWithBlockingIssues === 0
        ? "None of the published pages has a problem the page checker blocks on."
        : `${facts.pagesWithBlockingIssues} published ${facts.pagesWithBlockingIssues === 1 ? "page has" : "pages have"} a problem the page checker blocks on.`,
  );
  return lines;
}

/**
 * What the owner says about the site's accessibility, and a draft statement made from it (wave 1, 1e, docs/wave-1-trust.md 2.3). The status
 * starts at "not assessed", and the statement says exactly that until an assessment is given: the form refuses to say the site meets the
 * requirements without who assessed it and when. An automated check finds only part of the problems; the page says so.
 */
export function AccessibilityForm({
  settings,
  facts,
  body,
  contactDefault,
  actions,
  legalHref,
}: {
  settings: A11ySettings;
  facts: A11yFacts;
  body: EnforcementBody | null;
  /** The store's contact email, which the statement uses when none is given here. */
  contactDefault: string | null;
  actions: { save: Action; createStatement: Action };
  legalHref: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      <p role="note" className="rounded-lg border border-border bg-background p-4 text-sm">
        <strong className="font-semibold">An automated check finds only part of the problems</strong> and does not replace an assessment by someone who knows
        accessibility. This page never says the site meets the requirements on its own: that needs an assessment you give below. The statement text is a draft
        written by hand and not checked by a lawyer.
      </p>

      <section aria-labelledby="facts-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="facts-heading" className="mb-2 font-medium">
          What the site itself knows
        </h2>
        <ul className="list-disc pl-5 text-sm">
          {factLines(facts).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">The statement includes these as they stand when you make it.</p>
      </section>

      <ActionForm action={actions.save} className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
          <legend className="px-1 font-medium">Assessment</legend>
          {A11Y_STATUSES.map((status) => (
            <label key={status} className="flex items-start gap-2 text-sm">
              <input type="radio" name="status" value={status} defaultChecked={settings.status === status} className="mt-1 size-4" />
              <span>
                <span className="font-medium">{A11Y_STATUS_WORDS[status].name}</span>
                <span className="block text-muted">{A11Y_STATUS_WORDS[status].hint}</span>
              </span>
            </label>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Assessed by
              <input name="assessedBy" defaultValue={settings.assessedBy ?? ""} maxLength={200} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Assessed on
              <input type="date" name="assessedOn" defaultValue={settings.assessedOn ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
              Link to the report
              <input type="url" name="reportUrl" defaultValue={settings.reportUrl ?? ""} placeholder="https://" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
              Notes from the assessment
              <textarea name="assessmentNote" defaultValue={settings.assessmentNote ?? ""} rows={3} maxLength={2000} className={`${field} py-2`} />
            </label>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
          <legend className="px-1 font-medium">The statement</legend>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Known issues
            <textarea name="knownIssues" defaultValue={settings.knownIssues} rows={4} maxLength={4000} className={`${field} py-2`} />
            <span className="text-xs font-normal text-muted">One issue to a line. Parts of the site that are not accessible, and what you will do about them.</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="microenterprise" defaultChecked={settings.microenterprise} className="mt-1 size-4" />
            <span>
              <span className="font-medium">The business is a microenterprise</span>
              <span className="block text-muted">Fewer than 10 people and a turnover or balance sheet of at most EUR 2 million. The statement then says the requirements do not apply to it. Only tick it if it is true.</span>
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-3">
              Feedback contact
              <input type="email" name="contactEmail" defaultValue={settings.contactEmail ?? ""} placeholder={contactDefault ?? ""} className={field} />
              <span className="text-xs font-normal text-muted">Where people can report a barrier. Left empty, the store&apos;s contact email is used.</span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Prepared on
              <input type="date" name="preparedOn" defaultValue={settings.preparedOn ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Last reviewed on
              <input type="date" name="reviewedOn" defaultValue={settings.reviewedOn ?? ""} className={field} />
            </label>
          </div>
          {body && (
            <p className="text-sm text-muted">
              For a shop in {body.country} the statement names <strong className="font-semibold text-foreground">{body.body}</strong>
              {body.verified ? "." : ", marked as not verified: the text tells readers to check with the authority. Nobody has confirmed this body yet."}
            </p>
          )}
        </fieldset>
        <div>
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>

      <section aria-labelledby="draft-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="draft-heading" className="mb-1 font-medium">
          Make a draft statement
        </h2>
        <p className="mb-3 text-sm text-muted">
          Makes a draft page from what is saved above and what the site knows, in the store&apos;s language and the others among Norwegian, Swedish, Danish and
          English. It is never published for you. Save your changes first. Then publish it and choose it as the accessibility statement under{" "}
          <Link href={legalHref} className="underline">
            Legal pages
          </Link>
          .
        </p>
        <ActionForm action={actions.createStatement}>
          <SubmitButton variant="secondary">Create a draft statement</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
