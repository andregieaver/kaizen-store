import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { countWords, fillWords } from "@/lib/admin-fill";
import { legalEn, type LegalMessages } from "@/lib/admin-messages/legal.en";
import { A11Y_STATUSES, type A11yFacts, type A11ySettings, type EnforcementBody } from "@/lib/a11y-statement";
import { Card, CARD_CLASS } from "@/components/admin/ui";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const field = "min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";

/** What the site itself knows, in sentences: a count that cannot be known says so, never zero. */
export function factLines(facts: A11yFacts, words: LegalMessages = legalEn): string[] {
  const w = words.a11y.facts;
  const lines: string[] = [];
  lines.push(facts.themeWarnings === 0 ? w.contrastOk : fillWords(w.contrastLow, { n: facts.themeWarnings }));
  lines.push(
    facts.mediaWithoutAlt === null
      ? w.altUnknown
      : facts.mediaWithoutAlt.total === 0
        ? w.altEmpty
        : fillWords(w.altMissing, { missing: facts.mediaWithoutAlt.missing, total: facts.mediaWithoutAlt.total }),
  );
  lines.push(
    facts.pagesWithBlockingIssues === null
      ? w.pagesUnknown
      : facts.pagesWithBlockingIssues === 0
        ? w.pagesNone
        : countWords(facts.pagesWithBlockingIssues, w.pagesSome),
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
  words = legalEn,
}: {
  settings: A11ySettings;
  facts: A11yFacts;
  body: EnforcementBody | null;
  /** The store's contact email, which the statement uses when none is given here. */
  contactDefault: string | null;
  actions: { save: Action; createStatement: Action };
  legalHref: string;
  /** The words, in the account's language (D312 A8); English unless given. */
  words?: LegalMessages;
}) {
  const w = words.a11y;
  return (
    <div className="flex flex-col gap-8">
      <p role="note" className="rounded-panel border border-line bg-card p-4 text-sm">
        <strong className="font-medium">{w.noteLead}</strong>
        {w.note}
      </p>

      <Card title={w.knowsTitle} compact>
        <ul className="list-disc pl-5 text-sm">
          {factLines(facts, words).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">{w.knowsNote}</p>
      </Card>

      <ActionForm action={actions.save} className="flex flex-col gap-6">
        <fieldset className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
          <legend className="px-1 font-medium">{w.assessment}</legend>
          {A11Y_STATUSES.map((status) => (
            <label key={status} className="flex items-start gap-2 text-sm">
              <input type="radio" name="status" value={status} defaultChecked={settings.status === status} className="mt-1 size-4" />
              <span>
                <span className="font-medium">{w.statuses[status].name}</span>
                <span className="block text-muted">{w.statuses[status].hint}</span>
              </span>
            </label>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.assessedBy}
              <input name="assessedBy" defaultValue={settings.assessedBy ?? ""} maxLength={200} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.assessedOn}
              <input type="date" name="assessedOn" defaultValue={settings.assessedOn ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
              {w.report}
              <input type="url" name="reportUrl" defaultValue={settings.reportUrl ?? ""} placeholder="https://" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
              {w.assessmentNote}
              <textarea name="assessmentNote" defaultValue={settings.assessmentNote ?? ""} rows={3} maxLength={2000} className={`${field} py-2`} />
            </label>
          </div>
        </fieldset>

        <fieldset className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
          <legend className="px-1 font-medium">{w.statement}</legend>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.knownIssues}
            <textarea name="knownIssues" defaultValue={settings.knownIssues} rows={4} maxLength={4000} className={`${field} py-2`} />
            <span className="text-xs font-normal text-muted">{w.knownIssuesHint}</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="microenterprise" defaultChecked={settings.microenterprise} className="mt-1 size-4" />
            <span>
              <span className="font-medium">{w.micro}</span>
              <span className="block text-muted">{w.microHint}</span>
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-3">
              {w.contact}
              <input type="email" name="contactEmail" defaultValue={settings.contactEmail ?? ""} placeholder={contactDefault ?? ""} className={field} />
              <span className="text-xs font-normal text-muted">{w.contactHint}</span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.preparedOn}
              <input type="date" name="preparedOn" defaultValue={settings.preparedOn ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.reviewedOn}
              <input type="date" name="reviewedOn" defaultValue={settings.reviewedOn ?? ""} className={field} />
            </label>
          </div>
          {body && (
            <p className="text-sm text-muted">
              {fillWords(w.bodyFor, { country: body.country })}
              <strong className="font-medium text-ink">{body.body}</strong>
              {body.verified ? w.bodyVerified : w.bodyUnverified}
            </p>
          )}
        </fieldset>
        <div>
          <SubmitButton>{w.save}</SubmitButton>
        </div>
      </ActionForm>

      <Card title={w.draftTitle} compact>
        <p className="mb-3 text-sm text-muted">
          {w.draftText}
          <Link href={legalHref} className="underline">
            {w.draftLink}
          </Link>
          .
        </p>
        <ActionForm action={actions.createStatement}>
          <SubmitButton variant="secondary">{w.draftButton}</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
