import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { addMonths, startOfMonth } from "@/lib/analytics-period";
import { formatCount, formatPercent, safeRatio } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { fillWords } from "@/lib/admin-fill";
import { analyticsDateLocale } from "@/lib/analytics-lang";
import { analyticsWords, countText } from "@/lib/analytics-words";
import {
  analyticsSettingsText,
  settingsEntered,
  type AnalyticsSettings,
  type AnalyticsSettingsInput,
} from "@/lib/analytics-settings";
import type { AnalyticsSetupSummary } from "@/server/analytics-settings-data";
import type { StoredTarget } from "@/server/analytics-settings";

import { DataTable, StatusPill, type Column } from "./data-table";
import { AnalyticsSection, Note } from "./section";

/**
 * The analytics settings page's forms and the view that holds them (D152, `docs/analytics.md`): what products cost, the fees and
 * costs the store cannot see, the customer's lifetime, monthly revenue targets and visit counting. The view takes plain props
 * (the values, and the server actions already bound to the store), reads nothing itself and works with no script: every form posts,
 * and the one step that needs a confirmation (applying costs to earlier orders) is a `<details>` that opens it.
 */

type FormAction = (state: FormState, form: FormData) => Promise<FormState>;

/** The server actions the page binds to the store. Without them (a member who is not an owner) the view is read-only. */
export type SettingsActions = {
  saveSettings: FormAction;
  saveTarget: FormAction;
  deleteTarget: FormAction;
  setVisitCounting: FormAction;
  backfillCosts: FormAction;
};

export type AnalyticsSettingsViewProps = {
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  /** The store's main currency: every amount typed or shown here is in it. */
  currency: string;
  /** The first market's locale, for writing amounts. */
  locale: string;
  /** What day it is in the store's time zone (`YYYY-MM-DD`). */
  today: string;
  settings: AnalyticsSettings & { saved: boolean };
  summary: AnalyticsSetupSummary;
  targets: readonly StoredTarget[];
  visitCounting: boolean;
  /** Null for a member who may look but not change. */
  actions: SettingsActions | null;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------


const asDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** "October 2026" for a month given as `YYYY-MM` or any day in it, in the admin's language (`locale`, else the page's). */
export function monthLabel(month: string, locale = analyticsDateLocale()): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(asDate(`${month.slice(0, 7)}-01`));
}

/** "3 September 2026" for a day. */
export function dayLabel(day: string, locale = analyticsDateLocale()): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(asDate(day));
}

/** The months a target can be set for: this one and the eleven after it, as `YYYY-MM` with their names. */
export function monthChoices(today: string, count = 12): { value: string; label: string }[] {
  const first = startOfMonth(today);
  return Array.from({ length: count }, (_, i) => {
    const month = addMonths(first, i);
    return { value: month.slice(0, 7), label: monthLabel(month) };
  });
}

/** The targets of the next twelve months (this one included), earliest first; a target far out or long past is not listed. */
export function upcomingTargets(targets: readonly StoredTarget[], today: string, count = 12): StoredTarget[] {
  const first = startOfMonth(today);
  const end = addMonths(first, count);
  return targets.filter((t) => t.month >= first && t.month < end).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * What the settings form sent, laid over what is kept: the costs form sends the four cost fields and the lifetime form only the
 * years, so each leaves the other's values as they are. Returns what `parseAnalyticsSettings()` takes (text for the money and the
 * percentage, a number for the years); a years field that is not a number becomes 0, which the parser refuses in words.
 */
export function settingsFromForm(form: Record<string, FormDataEntryValue>, current: AnalyticsSettings, currency: string): AnalyticsSettingsInput {
  const kept = analyticsSettingsText(current, currency);
  const text = (key: keyof AnalyticsSettingsInput) => (typeof form[key] === "string" ? (form[key] as string) : null);
  const years = text("ltvLifespanYears");
  const asYears = years === null ? kept.ltvLifespanYears : Number.isFinite(Number(years)) && years.trim() !== "" ? Number(years) : 0;
  return {
    paymentFeePercent: text("paymentFeePercent") ?? kept.paymentFeePercent,
    paymentFeeFixed: text("paymentFeeFixed") ?? kept.paymentFeeFixed,
    shippingCost: text("shippingCost") ?? kept.shippingCost,
    fixedCostsMonthly: text("fixedCostsMonthly") ?? kept.fixedCostsMonthly,
    ltvLifespanYears: asYears,
  };
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

/** A catalogue's text with some placeholders filled by elements (a figure set in bold), the rest of it plain text. */
function fillNodes(template: string, values: Record<string, ReactNode>): ReactNode[] {
  return template.split(/\{(\w+)\}/).map((part, i) => (i % 2 === 1 ? <Fragment key={i}>{part in values ? values[part] : `{${part}}`}</Fragment> : part));
}

const field = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";

function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

/** A box for an amount or a percentage with its unit beside it, so the owner never wonders what it is in. */
function UnitInput({ name, unit, defaultValue, placeholder }: { name: string; unit: string; defaultValue: string; placeholder: string }) {
  return (
    <span className="flex items-center gap-2">
      <input name={name} defaultValue={defaultValue} placeholder={placeholder} inputMode="decimal" autoComplete="off" className={`${field} max-w-48 tabular-nums`} />
      <span className="text-sm font-normal text-muted">{unit}</span>
    </span>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}


// ---------------------------------------------------------------------------
// 1. What your products cost
// ---------------------------------------------------------------------------

function CostsSection({ base, currency, summary, actions }: Pick<AnalyticsSettingsViewProps, "base" | "currency" | "summary" | "actions">) {
  const { activeVariants, variantsWithCost, backfillableLines } = summary;
  const share = safeRatio(variantsWithCost, activeVariants);
  const lines = formatCount(backfillableLines);
  const w = analyticsWords().settings.costs;
  const withCost = formatCount(variantsWithCost);
  const all = formatCount(activeVariants);
  return (
    <AnalyticsSection id="costs" title={w.title} description={fillWords(w.description, { currency })}>
      <div className={card}>
        {activeVariants === 0 ? (
          <p className="text-sm text-muted">{w.noProducts}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              {fillNodes(w.haveCost, {
                with: <span className="font-medium tabular-nums">{withCost}</span>,
                all: <span className="font-medium tabular-nums">{all}</span>,
                share: formatPercent(share, 0),
              })}
            </p>
            <div
              role="meter"
              aria-label={w.meter}
              aria-valuemin={0}
              aria-valuemax={activeVariants}
              aria-valuenow={variantsWithCost}
              aria-valuetext={fillWords(w.meterText, { with: withCost, all })}
              className="h-2 w-full max-w-md overflow-hidden rounded-full border border-line bg-sunken"
            >
              <div className="h-full bg-brand" style={{ width: `${Math.round((share ?? 0) * 100)}%` }} />
            </div>
          </div>
        )}
        {activeVariants > 0 && variantsWithCost === 0 ? (
          <Note tone="warning" title={w.noneTitle}>
            {w.none}
          </Note>
        ) : null}
        {activeVariants > 0 && variantsWithCost > 0 && variantsWithCost < activeVariants ? (
          <Note title={w.someTitle}>{w.some}</Note>
        ) : null}
        <p className="text-sm">
          <Link href={`${base}/products`} className="underline">
            {w.goToProducts}
          </Link>
          <span className="text-muted">{w.toEnter}</span>
        </p>

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="text-body-strong text-ink">{w.earlier}</h3>
          {variantsWithCost === 0 ? (
            <p className="text-sm text-muted">{w.earlierNone}</p>
          ) : backfillableLines === 0 ? (
            <p className="text-sm text-muted">{w.earlierDone}</p>
          ) : actions ? (
            <details className="max-w-xl rounded-panel bg-sunken">
              <summary className="min-h-10 cursor-pointer list-none px-4 py-2.5 text-sm font-medium">{w.apply}</summary>
              <div className="border-t border-line p-4">
                <ActionForm action={actions.backfillCosts} className="flex flex-col gap-3" replaceOnSuccess successMessage={countText(w.updated, 0)}>
                  <p className="text-sm">{fillNodes(backfillableLines === 1 ? w.gives.one : w.gives.many, { n: <strong className="tabular-nums">{lines}</strong> })}</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                    <li>{w.once}</li>
                    <li>{w.kept}</li>
                    <li>{w.noUndo}</li>
                  </ul>
                  <div>
                    <SubmitButton>{countText(w.confirm, backfillableLines, {}, lines)}</SubmitButton>
                  </div>
                </ActionForm>
              </div>
            </details>
          ) : (
            <p className="text-sm text-muted">{fillNodes(backfillableLines === 1 ? w.waiting.one : w.waiting.many, { n: <span className="tabular-nums">{lines}</span> })}</p>
          )}
        </div>
      </div>
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// 2. Fees and costs we cannot see
// ---------------------------------------------------------------------------

function FeesSection({ currency, locale, settings, actions }: Pick<AnalyticsSettingsViewProps, "currency" | "locale" | "settings" | "actions">) {
  const text = analyticsSettingsText(settings, currency);
  const words = analyticsWords().settings;
  const w = words.fees;
  const money = (minor: number) => (minor > 0 ? formatAmount(minor, currency, locale) : words.notEntered);
  return (
    <AnalyticsSection id="fees" title={w.title} description={w.description}>
      <div className={card}>
        {!settingsEntered(settings) ? (
          <Note title={w.nothingTitle}>{w.nothing}</Note>
        ) : null}
        {actions ? (
          <ActionForm action={actions.saveSettings} className="flex flex-col gap-4" successMessage={w.saved}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={w.percent} hint={w.percentHint}>
                <UnitInput name="paymentFeePercent" unit="%" defaultValue={text.paymentFeePercent} placeholder="2,9" />
              </Field>
              <Field label={w.fixed} hint={w.fixedHint}>
                <UnitInput name="paymentFeeFixed" unit={currency} defaultValue={text.paymentFeeFixed} placeholder="2,00" />
              </Field>
              <Field label={w.shipping} hint={w.shippingHint}>
                <UnitInput name="shippingCost" unit={currency} defaultValue={text.shippingCost} placeholder="60,00" />
              </Field>
              <Field label={w.fixedCosts} hint={w.fixedCostsHint}>
                <UnitInput name="fixedCostsMonthly" unit={currency} defaultValue={text.fixedCostsMonthly} placeholder="25 000" />
              </Field>
            </div>
            <div>
              <SubmitButton>{w.save}</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <dl className="divide-y divide-line">
            <ReadOnly label={w.percent} value={settings.paymentFeeBps > 0 ? formatPercent(settings.paymentFeeBps / 10_000, 2) : words.notEntered} />
            <ReadOnly label={w.fixed} value={money(settings.paymentFeeFixedMinor)} />
            <ReadOnly label={w.shipping} value={money(settings.shippingCostMinor)} />
            <ReadOnly label={w.fixedCosts} value={money(settings.fixedCostsMonthlyMinor)} />
          </dl>
        )}
        <p className="text-sm text-muted">{fillWords(w.real, { currency })}</p>
      </div>
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// 3. Customer lifetime
// ---------------------------------------------------------------------------

function LifetimeSection({ settings, actions }: Pick<AnalyticsSettingsViewProps, "settings" | "actions">) {
  const years = settings.ltvLifespanYears;
  const w = analyticsWords().settings.lifetime;
  return (
    <AnalyticsSection
      id="lifetime"
      title={w.title}
      description={
        <>
          {w.before}
          <abbr title={w.abbrTitle}>{w.abbr}</abbr>
          {w.after}
        </>
      }
    >
      <div className={card}>
        {actions ? (
          <ActionForm action={actions.saveSettings} className="flex flex-col gap-4" successMessage={w.saved}>
            <Field label={w.years} hint={w.yearsHint}>
              <span className="flex items-center gap-2">
                <input name="ltvLifespanYears" type="number" min={1} max={10} step={1} defaultValue={years} inputMode="numeric" className={`${field} max-w-28 tabular-nums`} />
                <span className="text-sm font-normal text-muted">{years === 1 ? w.unit.one : w.unit.many}</span>
              </span>
            </Field>
            <div>
              <SubmitButton>{w.save}</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <dl>
            <ReadOnly label={w.years} value={countText(w.value, years)} />
          </dl>
        )}
        {!settings.saved ? <p className="text-sm text-muted">{w.notSet}</p> : null}
      </div>
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// 4. Revenue targets
// ---------------------------------------------------------------------------

function TargetsSection({ currency, locale, today, targets, actions }: Pick<AnalyticsSettingsViewProps, "currency" | "locale" | "today" | "targets" | "actions">) {
  const listed = upcomingTargets(targets, today);
  const w = analyticsWords().settings.targets;
  const columns: Column<StoredTarget>[] = [
    { key: "month", label: w.month, cell: (t) => monthLabel(t.month) },
    { key: "target", label: fillWords(w.target, { currency }), align: "right", cell: (t) => formatAmount(t.revenueTargetMinor, currency, locale) },
  ];
  if (actions) {
    columns.push({
      key: "remove",
      label: w.remove,
      align: "right",
      cell: (t) => (
        <ActionForm action={actions.deleteTarget} replaceOnSuccess successMessage={w.removed} className="flex justify-end">
          <input type="hidden" name="month" value={t.month.slice(0, 7)} />
          <SubmitButton variant="secondary">
            {w.remove}
            <span className="sr-only">{fillWords(w.removeFor, { month: monthLabel(t.month) })}</span>
          </SubmitButton>
        </ActionForm>
      ),
    });
  }
  return (
    <AnalyticsSection id="targets" title={w.title} description={w.description}>
      <div className={card}>
        {actions ? (
          <ActionForm action={actions.saveTarget} className="flex flex-col gap-4" successMessage={w.saved}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={w.month}>
                <select name="month" defaultValue={monthChoices(today)[0].value} className={field}>
                  {monthChoices(today).map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={w.field} hint={w.fieldHint}>
                <UnitInput name="revenueTarget" unit={currency} defaultValue="" placeholder="500 000" />
              </Field>
            </div>
            <div>
              <SubmitButton>{w.save}</SubmitButton>
            </div>
          </ActionForm>
        ) : null}
        <div className="flex flex-col gap-2">
          <h3 className="text-body-strong text-ink">{w.next}</h3>
          <DataTable
            caption={w.caption}
            columns={columns}
            rows={listed}
            rowKey={(t) => t.month}
            empty={w.empty}
            exportId="settings.targets"
          />
        </div>
      </div>
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// 5. Visit counting
// ---------------------------------------------------------------------------

function VisitsSection({ summary, visitCounting, actions }: Pick<AnalyticsSettingsViewProps, "summary" | "visitCounting" | "actions">) {
  const { firstCountedDay } = summary;
  const w = analyticsWords().settings.visits;
  const state = visitCounting
    ? firstCountedDay
      ? fillWords(w.countingFrom, { day: dayLabel(firstCountedDay) })
      : w.countingNone
    : firstCountedDay
      ? fillWords(w.offFrom, { day: dayLabel(firstCountedDay) })
      : w.offNone;
  return (
    <AnalyticsSection id="visits" title={w.title} description={w.description}>
      <div className={card}>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={visitCounting ? "good" : "neutral"}>{visitCounting ? w.on : w.off}</StatusPill>
          <p className="text-sm">{state}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-body-strong text-ink">{w.whatTitle}</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              {w.what.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-body-strong text-ink">{w.notTitle}</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>{w.notCookies}</li>
              <li>{w.notIp}</li>
              <li>{w.notHash}</li>
              <li>
                {w.botsBefore}
                <abbr title={w.gpcTitle}>{w.gpc}</abbr>
                {w.botsAfter}
              </li>
            </ul>
          </div>
        </div>

        <Note title={w.partTitle}>{w.part}</Note>

        {actions ? (
          <ActionForm
            action={actions.setVisitCounting}
            className="flex flex-col gap-3"
            successMessage={w.saved}
          >
            <div>
              <SubmitButton name="enabled" value={visitCounting ? "off" : "on"} variant={visitCounting ? "secondary" : "primary"}>
                {visitCounting ? w.turnOff : w.turnOn}
              </SubmitButton>
            </div>
          </ActionForm>
        ) : null}
      </div>
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** What the page answers, as links to the sections that do. */
const ANSWERS = ["costs", "targets", "visits"] as const;

export function AnalyticsSettingsView(props: AnalyticsSettingsViewProps) {
  const { base, currency, locale, today, settings, summary, targets, visitCounting, actions } = props;
  const w = analyticsWords().settings;
  return (
    <div className="flex flex-col gap-8">
      <nav aria-label={w.onThisPage}>
        <p className="text-sm font-medium">{w.answersLead}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
          {ANSWERS.map((a) => (
            <li key={a}>
              <a href={`#${a}`} className="underline">
                {w.answers[a]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {actions ? null : <Note title={w.ownersOnly.title}>{w.ownersOnly.body}</Note>}
      <CostsSection base={base} currency={currency} summary={summary} actions={actions} />
      <FeesSection currency={currency} locale={locale} settings={settings} actions={actions} />
      <LifetimeSection settings={settings} actions={actions} />
      <TargetsSection currency={currency} locale={locale} today={today} targets={targets} actions={actions} />
      <VisitsSection summary={summary} visitCounting={visitCounting} actions={actions} />
    </div>
  );
}
