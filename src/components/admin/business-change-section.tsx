import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { buttonClass, Card, Chip } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { BusinessMessages } from "@/lib/admin-messages/business.en";
import {
  BUSINESS_FORMS,
  BUSINESS_SERIES,
  businessChangeMissing,
  businessChangeWhen,
  type BusinessChecklistItem,
  type BusinessSeries,
  type BusinessStep,
} from "@/lib/business-change";
import type { BusinessChange } from "@/server/business-change";

type FormAction = (state: FormState, form: FormData) => Promise<FormState>;

export type BusinessChangeActions = {
  plan: FormAction;
  cancel: FormAction;
  tick: (step: BusinessStep, done: boolean) => () => Promise<void>;
};

const control = "min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";
const summaryButton = `${buttonClass("secondary", "card")} cursor-pointer list-none [&::-webkit-details-marker]:hidden`;

/**
 * Changing the business behind the store (B8, D473) on Settings → Company. Homer sees one thing at a time: a button to plan it; once
 * planned, "Your business becomes Human Web AS on 1 January 2027", what is still missing, and a checklist where each step says what to do,
 * links to where it is done and is ticked off. Lisa opens the details: the address from the day and each series' prefix.
 */
export function BusinessChangeSection({
  words: w,
  planned,
  applied,
  checklist,
  legalPagesNamingOld,
  series,
  current,
  links,
  today,
  locale,
  actions,
}: {
  words: BusinessMessages;
  planned: BusinessChange | null;
  applied: BusinessChange[];
  checklist: BusinessChecklistItem[] | null;
  legalPagesNamingOld: number;
  series: Partial<Record<BusinessSeries, { prefix: string; next: number }>>;
  /** The store's business as it is: its legal name and address. */
  current: { legalName: string; postalAddress: string };
  /** Where each step of the checklist is done in the admin. */
  links: Partial<Record<BusinessStep, string>>;
  today: string;
  locale: string;
  /** The owner's actions; none for a member who may only look. */
  actions: BusinessChangeActions | null;
}) {
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const when = planned ? businessChangeWhen(planned.startsOn, today) : null;
  const missing = planned ? businessChangeMissing(planned) : [];
  const nextFirst = `${Number(today.slice(0, 4)) + 1}-01-01`;
  const startOf = (s: BusinessSeries) => {
    const now = series[s];
    if (!now) return null;
    return `${planned?.prefixes[s] ?? now.prefix}${now.next}`;
  };
  return (
    <Card title={w.section} compact>
      {planned && when ? (
        <div className="flex flex-col gap-4 text-sm">
          <div>
            <p className="text-title text-ink">{fillWords(w.becoming, { name: planned.legalName, date: day(planned.startsOn) })}</p>
            <p className={when.kind === "overdue" ? "text-danger-text" : "text-muted"}>
              {when.kind === "ahead" ? countWords(when.days, w.daysLeft) : when.kind === "today" ? w.fromToday : w.overdue}
            </p>
          </div>
          {missing.length > 0 && (
            <ul className="flex flex-col gap-1">
              {missing.map((m) => (
                <li key={m}>
                  <Chip signal="warning">{w.missing[m]}</Chip>
                </li>
              ))}
            </ul>
          )}
          {checklist && (
            <section aria-labelledby="business-checklist">
              <h3 id="business-checklist" className="mb-2 text-body-strong text-ink">
                {fillWords(w.checklist, { name: planned.legalName })}
              </h3>
              <ol className="flex flex-col divide-y divide-line">
                {checklist.map((item) => (
                  <StepRow
                    key={item.step}
                    item={item}
                    words={w}
                    text={
                      item.step === "series"
                        ? fillWords(w.steps.series.text, { start: startOf("invoice") ?? "—" })
                        : item.step === "legal"
                          ? legalPagesNamingOld > 0
                            ? countWords(legalPagesNamingOld, w.steps.legal.text, { name: current.legalName })
                            : w.steps.legal.textDone
                          : w.steps[item.step].text
                    }
                    href={links[item.step] ?? null}
                    tick={actions && item.tickable ? actions.tick(item.step, item.state !== "done") : null}
                  />
                ))}
              </ol>
            </section>
          )}
          {actions && (
            <div className="flex flex-wrap items-start gap-3">
              <details className="w-full">
                <summary className={summaryButton}>{w.edit}</summary>
                <ChangeForm words={w} action={actions.plan} change={planned} current={current} series={series} min={today} submit={w.saveChange} />
              </details>
              <ActionForm action={actions.cancel}>
                <SubmitButton variant="secondary">{w.cancel}</SubmitButton>
              </ActionForm>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">{w.intro}</p>
          {actions && (
            <details>
              <summary className={summaryButton}>{w.start}</summary>
              <ChangeForm words={w} action={actions.plan} change={null} current={current} series={series} min={today} startsOn={nextFirst} submit={w.save} />
            </details>
          )}
        </div>
      )}
      {applied.length > 0 && (
        <section aria-labelledby="business-history" className="mt-5 border-t border-line pt-4 text-sm">
          <h3 id="business-history" className="mb-2 text-body-strong text-ink">
            {w.history}
          </h3>
          <ul className="flex flex-col gap-2">
            {applied.map((c) => (
              <li key={c.id}>
                <span className="text-ink">{fillWords(w.since, { name: c.legalName, date: day(c.startsOn) })}</span>
                {c.before?.legalName && <span className="block text-muted">{fillWords(w.before, { name: c.before.legalName })}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Card>
  );
}

/** One step: done, to do, or what Kaizena Flow does; where it is done; and, for the owner, ticked off with one press. */
function StepRow({ item, words: w, text, href, tick }: { item: BusinessChecklistItem; words: BusinessMessages; text: string; href: string | null; tick: (() => Promise<void>) | null }) {
  const title = w.steps[item.step].title;
  const link = "link" in w.steps[item.step] ? (w.steps[item.step] as { link: string }).link : null;
  const look = `mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border ${item.state === "done" ? "border-positive-line bg-positive-soft text-positive-text" : item.state === "info" ? "border-line bg-sunken text-muted" : "border-edge bg-card"}`;
  const mark = (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-4 ${item.state === "done" ? "" : "opacity-0"}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
  return (
    <li className="flex items-start gap-3 py-3">
      {tick ? (
        <form action={tick}>
          <button type="submit" aria-pressed={item.state === "done"} aria-label={fillWords(item.state === "done" ? w.markOpen : w.markDone, { step: title })} className={`${look} hover:bg-sunken`}>
            {mark}
          </button>
        </form>
      ) : (
        <span className={look}>
          {item.state === "info" ? <span aria-hidden="true">i</span> : mark}
          <span className="sr-only">{item.state === "done" ? w.doneLabel : ""}</span>
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={item.state === "done" ? "text-muted" : "text-ink"}>{title}</p>
        <p className="text-muted">{text}</p>
        {href && link && item.state !== "done" && (
          <Link href={href} className="w-fit text-ink-2 underline">
            {link}
          </Link>
        )}
      </div>
    </li>
  );
}

/** The change's fields: the new business, its day and numbers; the address and each series' prefix one step further. */
function ChangeForm({
  words: w,
  action,
  change,
  current,
  series,
  min,
  startsOn,
  submit,
}: {
  words: BusinessMessages;
  action: FormAction;
  change: BusinessChange | null;
  current: { legalName: string; postalAddress: string };
  series: Partial<Record<BusinessSeries, { prefix: string; next: number }>>;
  min: string;
  startsOn?: string;
  submit: string;
}) {
  return (
    <ActionForm action={action} className="mt-4 flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.legalName}
        <input name="legalName" required maxLength={200} defaultValue={change?.legalName ?? ""} className={control} />
      </label>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.form}
          <select name="businessForm" defaultValue={change?.businessForm ?? "as"} className={control}>
            {BUSINESS_FORMS.map((form) => (
              <option key={form} value={form}>
                {w.forms[form]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.startsOn}
          <input type="date" name="startsOn" required min={min} defaultValue={change?.startsOn ?? startsOn} className={control} />
        </label>
      </div>
      <p className="-mt-2 text-sm text-muted">{w.startsOnHint}</p>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.organisationNumber}
        <input name="organisationNumber" inputMode="numeric" defaultValue={change?.organisationNumber ?? ""} className={`${control} max-w-xs`} />
        <span className="font-normal text-muted">{w.organisationNumberHint}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="vatRegistered" defaultChecked={change ? change.vatRegistered : true} className="size-4" />
        {w.vatRegistered}
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.vatNumber}
        <input name="vatNumber" defaultValue={change?.vatNumber ?? ""} className={`${control} max-w-xs`} />
        <span className="font-normal text-muted">{w.vatNumberHint}</span>
      </label>
      <details className="rounded-md border border-line p-3">
        <summary className="cursor-pointer text-sm font-medium">{w.more}</summary>
        <div className="mt-3 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.address}
            <textarea name="postalAddress" rows={2} maxLength={300} defaultValue={change?.postalAddress ?? ""} className={`${control} py-2`} />
            {current.postalAddress.trim() && <span className="font-normal text-muted">{fillWords(w.addressHint, { address: current.postalAddress.replace(/\n/g, ", ") })}</span>}
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{w.prefixes}</legend>
            <p className="text-sm text-muted">{w.prefixesHint}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {BUSINESS_SERIES.filter((s) => series[s]).map((s) => (
                <label key={s} className="flex flex-col gap-1 text-sm">
                  {w.seriesNames[s]}
                  <input name={`prefix_${s}`} maxLength={10} defaultValue={change?.prefixes[s] ?? ""} placeholder={series[s]?.prefix} className={control} />
                  <span className="text-muted">{fillWords(w.keeps, { prefix: series[s]?.prefix || "—" })}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>
      <div>
        <SubmitButton>{submit}</SubmitButton>
      </div>
    </ActionForm>
  );
}
