import Link from "next/link";
import type { ReactNode } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { addMonths, startOfMonth } from "@/lib/analytics-period";
import { formatCount, formatPercent, safeRatio } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
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

const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dayName = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const asDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** "October 2026" for a month given as `YYYY-MM` or any day in it. */
export function monthLabel(month: string): string {
  return monthName.format(asDate(`${month.slice(0, 7)}-01`));
}

/** "3 September 2026" for a day. */
export function dayLabel(day: string): string {
  return dayName.format(asDate(day));
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

const field = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";

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

const NOT_ENTERED = "Not entered";

// ---------------------------------------------------------------------------
// 1. What your products cost
// ---------------------------------------------------------------------------

function CostsSection({ base, currency, summary, actions }: Pick<AnalyticsSettingsViewProps, "base" | "currency" | "summary" | "actions">) {
  const { activeVariants, variantsWithCost, backfillableLines } = summary;
  const share = safeRatio(variantsWithCost, activeVariants);
  const lines = formatCount(backfillableLines);
  return (
    <AnalyticsSection
      id="costs"
      title="What your products cost"
      description={`Profit is what you sell for minus what the goods cost you. Enter the cost of one unit of each variant in the product editor, in ${currency} and without VAT. The cost is kept on each order line when it is sold, so changing a cost later never rewrites earlier sales.`}
    >
      <div className={card}>
        {activeVariants === 0 ? (
          <p className="text-sm text-muted">You have no products on sale yet. Costs are entered on each product&apos;s variants once you do.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              <span className="font-medium tabular-nums">{formatCount(variantsWithCost)}</span> of{" "}
              <span className="font-medium tabular-nums">{formatCount(activeVariants)}</span> variants on sale have a cost ({formatPercent(share, 0)}).
            </p>
            <div
              role="meter"
              aria-label="Variants on sale that have a cost"
              aria-valuemin={0}
              aria-valuemax={activeVariants}
              aria-valuenow={variantsWithCost}
              aria-valuetext={`${formatCount(variantsWithCost)} of ${formatCount(activeVariants)}`}
              className="h-2 w-full max-w-md overflow-hidden rounded-full border border-border bg-surface"
            >
              <div className="h-full bg-foreground" style={{ width: `${Math.round((share ?? 0) * 100)}%` }} />
            </div>
          </div>
        )}
        {activeVariants > 0 && variantsWithCost === 0 ? (
          <Note tone="warning" title="No costs entered yet">
            Until you add costs, profit is not shown at all: showing sales as profit would be wrong. Add them in the product editor.
          </Note>
        ) : null}
        {activeVariants > 0 && variantsWithCost > 0 && variantsWithCost < activeVariants ? (
          <Note title="Some costs are missing">
            Profit is worked out only for sales of variants whose cost is known, and the page says how much of your sales that covers.
          </Note>
        ) : null}
        <p className="text-sm">
          <Link href={`${base}/products`} className="underline">
            Go to your products
          </Link>{" "}
          <span className="text-muted">to enter or change costs.</span>
        </p>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Costs on earlier orders</h3>
          {variantsWithCost === 0 ? (
            <p className="text-sm text-muted">Once variants have a cost you can apply it to orders sold before you entered it.</p>
          ) : backfillableLines === 0 ? (
            <p className="text-sm text-muted">No earlier order lines are waiting for a cost: every line whose variant has a cost already has it.</p>
          ) : actions ? (
            <details className="max-w-xl rounded-lg border border-border bg-surface">
              <summary className="min-h-10 cursor-pointer list-none px-4 py-2.5 text-sm font-medium">Apply costs to earlier orders</summary>
              <div className="border-t border-border p-4">
                <ActionForm action={actions.backfillCosts} className="flex flex-col gap-3" replaceOnSuccess successMessage="Updated 0 order lines.">
                  <p className="text-sm">
                    This gives <strong className="tabular-nums">{lines}</strong> earlier order {backfillableLines === 1 ? "line" : "lines"} the cost its variant has
                    today.
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                    <li>It is done once, with today&apos;s costs: they may differ from what the goods cost back then.</li>
                    <li>A line that already has a cost is never changed, and neither are copied orders.</li>
                    <li>It cannot be undone in one step.</li>
                  </ul>
                  <div>
                    <SubmitButton>Yes, apply costs to {lines} order {backfillableLines === 1 ? "line" : "lines"}</SubmitButton>
                  </div>
                </ActionForm>
              </div>
            </details>
          ) : (
            <p className="text-sm text-muted">
              <span className="tabular-nums">{lines}</span> earlier order {backfillableLines === 1 ? "line was" : "lines were"} sold before its variant had a cost.
              An owner can apply costs to them.
            </p>
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
  const money = (minor: number) => (minor > 0 ? formatAmount(minor, currency, locale) : NOT_ENTERED);
  return (
    <AnalyticsSection
      id="fees"
      title="Fees and costs we cannot see"
      description="Your sales are known exactly; some of what they cost you is not. These are your own estimates. They are used only for the profit figures, which say they are estimated, and they never change an order."
    >
      <div className={card}>
        {!settingsEntered(settings) ? (
          <Note title="Nothing entered yet">
            Profit figures leave these costs out and say so. Enter what you know now; you can change it any time, and the figures follow.
          </Note>
        ) : null}
        {actions ? (
          <ActionForm action={actions.saveSettings} className="flex flex-col gap-4" successMessage="Saved. Profit figures use these estimates from now on.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Payment fee, percent of each order"
                hint="Your payment provider's percentage, taken on the order's total including VAT. Check its price list."
              >
                <UnitInput name="paymentFeePercent" unit="%" defaultValue={text.paymentFeePercent} placeholder="2,9" />
              </Field>
              <Field label="Payment fee, fixed amount per order" hint="The fixed part of the fee, if your provider charges one.">
                <UnitInput name="paymentFeeFixed" unit={currency} defaultValue={text.paymentFeeFixed} placeholder="2,00" />
              </Field>
              <Field label="Shipping cost per order" hint="What sending one order costs you. Counted for orders with something to ship.">
                <UnitInput name="shippingCost" unit={currency} defaultValue={text.shippingCost} placeholder="60,00" />
              </Field>
              <Field label="Fixed costs per month" hint="Rent, pay, software and anything else that does not depend on sales. Spread evenly over the days.">
                <UnitInput name="fixedCostsMonthly" unit={currency} defaultValue={text.fixedCostsMonthly} placeholder="25 000" />
              </Field>
            </div>
            <div>
              <SubmitButton>Save estimates</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <dl className="divide-y divide-border">
            <ReadOnly label="Payment fee, percent of each order" value={settings.paymentFeeBps > 0 ? formatPercent(settings.paymentFeeBps / 10_000, 2) : NOT_ENTERED} />
            <ReadOnly label="Payment fee, fixed amount per order" value={money(settings.paymentFeeFixedMinor)} />
            <ReadOnly label="Shipping cost per order" value={money(settings.shippingCostMinor)} />
            <ReadOnly label="Fixed costs per month" value={money(settings.fixedCostsMonthlyMinor)} />
          </dl>
        )}
        <p className="text-sm text-muted">
          What Kaizen takes on each sale is real, not an estimate, and needs no entry. Money here is typed like a price, in {currency}.
        </p>
      </div>
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// 3. Customer lifetime
// ---------------------------------------------------------------------------

function LifetimeSection({ settings, actions }: Pick<AnalyticsSettingsViewProps, "settings" | "actions">) {
  const years = settings.ltvLifespanYears;
  return (
    <AnalyticsSection
      id="lifetime"
      title="Customer lifetime"
      description={
        <>
          A customer&apos;s <abbr title="Lifetime value: what an average customer is worth to you over all the years they keep buying">lifetime value</abbr> is
          predicted from the profit on one order, how many orders a customer places in a year, and how many years you expect them to keep buying. This is that last
          number.
        </>
      }
    >
      <div className={card}>
        {actions ? (
          <ActionForm action={actions.saveSettings} className="flex flex-col gap-4" successMessage="Saved. Predicted lifetime value uses this from now on.">
            <Field label="Years a customer keeps buying" hint="Between 1 and 10. Three is a cautious start for most shops; use your own history when you have it.">
              <span className="flex items-center gap-2">
                <input name="ltvLifespanYears" type="number" min={1} max={10} step={1} defaultValue={years} inputMode="numeric" className={`${field} max-w-28 tabular-nums`} />
                <span className="text-sm font-normal text-muted">{years === 1 ? "year" : "years"}</span>
              </span>
            </Field>
            <div>
              <SubmitButton>Save lifetime</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <dl>
            <ReadOnly label="Years a customer keeps buying" value={`${years} ${years === 1 ? "year" : "years"}`} />
          </dl>
        )}
        {!settings.saved ? <p className="text-sm text-muted">Not set yet, so 3 years is used.</p> : null}
      </div>
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// 4. Revenue targets
// ---------------------------------------------------------------------------

function TargetsSection({ currency, locale, today, targets, actions }: Pick<AnalyticsSettingsViewProps, "currency" | "locale" | "today" | "targets" | "actions">) {
  const listed = upcomingTargets(targets, today);
  const columns: Column<StoredTarget>[] = [
    { key: "month", label: "Month", cell: (t) => monthLabel(t.month) },
    { key: "target", label: `Net revenue target (${currency})`, align: "right", cell: (t) => formatAmount(t.revenueTargetMinor, currency, locale) },
  ];
  if (actions) {
    columns.push({
      key: "remove",
      label: "Remove",
      align: "right",
      cell: (t) => (
        <ActionForm action={actions.deleteTarget} replaceOnSuccess successMessage="Removed." className="flex justify-end">
          <input type="hidden" name="month" value={t.month.slice(0, 7)} />
          <SubmitButton variant="secondary">
            Remove<span className="sr-only"> the target for {monthLabel(t.month)}</span>
          </SubmitButton>
        </ActionForm>
      ),
    });
  }
  return (
    <AnalyticsSection
      id="targets"
      title="Revenue targets"
      description="A target is the net revenue you want for a month: sales after discounts and refunds, without VAT. The overview shows how far you have come and whether you are ahead or behind."
    >
      <div className={card}>
        {actions ? (
          <ActionForm action={actions.saveTarget} className="flex flex-col gap-4" successMessage="Saved. The overview follows this target.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Month">
                <select name="month" defaultValue={monthChoices(today)[0].value} className={field}>
                  {monthChoices(today).map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Net revenue target" hint="A month that already has a target is replaced.">
                <UnitInput name="revenueTarget" unit={currency} defaultValue="" placeholder="500 000" />
              </Field>
            </div>
            <div>
              <SubmitButton>Save target</SubmitButton>
            </div>
          </ActionForm>
        ) : null}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Targets for the next 12 months</h3>
          <DataTable
            caption="Revenue targets for the next 12 months"
            columns={columns}
            rows={listed}
            rowKey={(t) => t.month}
            empty="No targets set. The overview shows progress once there is one for the current month."
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
  const state = visitCounting
    ? firstCountedDay
      ? `Counting visits. The first counted day is ${dayLabel(firstCountedDay)}.`
      : "Counting visits, but none has been counted yet."
    : firstCountedDay
      ? `Not counting. Visits were counted from ${dayLabel(firstCountedDay)}; what was counted is kept.`
      : "Not counting. No visits have been counted.";
  return (
    <AnalyticsSection
      id="visits"
      title="Visit counting"
      description="Visits are what the conversion rate, the funnel and the figures per channel and device are built on. Without them those figures show a dash and say why."
    >
      <div className={card}>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={visitCounting ? "good" : "neutral"}>{visitCounting ? "On" : "Off"}</StatusPill>
          <p className="text-sm">{state}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">What is counted</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>One line per visitor per day, with no name, contact detail, IP address or browser details on it.</li>
              <li>The market, the kind of device (phone, tablet or computer) and where the visitor came from: the link, or the campaign tag in it.</li>
              <li>The first page they landed on (only the kind of page and its address, never an order or a link with a code in it), how many pages and products they looked at, and whether they reached checkout.</li>
              <li>When something is added to the cart that day, the visit is tied to that cart, and so to the order made from it. That is how a sale gets its channel and device.</li>
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">What is not counted or kept</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>No cookies and nothing stored in the browser, so it shows no cookie banner.</li>
              <li>No IP address and no browser details are stored.</li>
              <li>
                The visitor is a hashed id made with a key that changes every day, so it cannot be followed from one day to the next, and the id cannot be turned back
                into an address. It is not random: the same visitor gets the same id for the rest of that store day.
              </li>
              <li>
                Bots are not counted, and neither are visitors whose browser sends <abbr title="Global Privacy Control: a browser setting that tells sites not to track the person">Global Privacy Control</abbr>{" "}
                or Do Not Track.
              </li>
            </ul>
          </div>
        </div>

        <Note title="Your part">
          Your cookie page describes this in each of your languages while it is on. Mention it in your privacy policy too, including that a visit is tied to a cart and its order: that
          text is yours to write and Kaizen does not write it for you. Counting starts when you switch it on and cannot be filled in for earlier days. Counted visits are deleted after
          25 months. Counts are not tamper-proof: a script can add visits, within limits per address and per day, so look at a sudden jump before you trust it.
        </Note>

        {actions ? (
          <ActionForm
            action={actions.setVisitCounting}
            className="flex flex-col gap-3"
            successMessage="Saved."
          >
            <div>
              <SubmitButton name="enabled" value={visitCounting ? "off" : "on"} variant={visitCounting ? "secondary" : "primary"}>
                {visitCounting ? "Turn off visit counting" : "Turn on visit counting"}
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
const ANSWERS = [
  { href: "#costs", text: "Does the profit know what your products cost, and what else it costs to sell?" },
  { href: "#targets", text: "What do you want to reach each month?" },
  { href: "#visits", text: "Are visits counted, and what exactly is counted?" },
] as const;

export function AnalyticsSettingsView(props: AnalyticsSettingsViewProps) {
  const { base, currency, locale, today, settings, summary, targets, visitCounting, actions } = props;
  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="On this page">
        <p className="text-sm font-medium">This page answers three things:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
          {ANSWERS.map((a) => (
            <li key={a.href}>
              <a href={a.href} className="underline">
                {a.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {actions ? null : (
        <Note title="Only owners can change these settings">
          You can see how the store is set up, but an owner has to change it. Ask an owner of the store if something here should be different.
        </Note>
      )}
      <CostsSection base={base} currency={currency} summary={summary} actions={actions} />
      <FeesSection currency={currency} locale={locale} settings={settings} actions={actions} />
      <LifetimeSection settings={settings} actions={actions} />
      <TargetsSection currency={currency} locale={locale} today={today} targets={targets} actions={actions} />
      <VisitsSection summary={summary} visitCounting={visitCounting} actions={actions} />
    </div>
  );
}
