"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { createRecurringAction, updateRecurringAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/recurring-actions";
import { bpToPercent } from "@/lib/work-calc";
import { QUANTITY_MESSAGE, VAT_CATEGORY_LABELS, quantityField } from "@/lib/work-invoice-ui";
import { NO_PROBLEMS, moneyField, type FormProblems } from "@/lib/work-ui";
import { PERIOD_LABELS, recurringPayload, type RecurringFormValues } from "@/lib/work-recurring-ui";
import { RECURRENCE_INTERVALS, RECURRENCE_PERIODS } from "@/lib/work-recurrence";
import { VAT_LINE_CATEGORIES } from "@/lib/work-vat";
import type { RecurringInvoice } from "@/server/work-recurring";

import { Field, Problems, control, hintText, primaryButton, secondaryButton } from "./work-parts";

export type RecurringFormProps = {
  storeSlug: string;
  clientId: string;
  /** The client's currency: a new template starts in it. */
  currency: string;
  currencies: string[];
  /** Today in the store's calendar: a new template starts today. */
  today: string;
  /** The template being changed; none makes a new one. */
  template?: RecurringInvoice;
  /** Only an owner switches automatic issuing on or off. */
  canAutoIssue: boolean;
  onDone?: (id: string) => void;
  onCancel?: () => void;
};

const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * A repeating invoice: what one period's invoice says (a line: text, quantity, net price, discount, VAT
 * category), how often, from when to when, and whether each invoice is issued and emailed by itself
 * (off unless an owner switches it on). Sent as JSON and checked by `recurringInvoiceInput` in the
 * browser and again on the server; what was typed stays when something is wrong.
 */
export function RecurringForm({
  storeSlug,
  clientId,
  currency,
  currencies,
  today,
  template,
  canAutoIssue,
  onDone,
  onCancel,
}: RecurringFormProps) {
  const editing = template !== undefined;
  const [unit, setUnit] = useState<string>(template?.unit ?? "unit");
  const [chosenCurrency, setChosenCurrency] = useState<string>(template?.currency ?? currency);
  const [auto, setAuto] = useState(template?.autoIssue ?? false);
  const [problems, setProblems] = useState<FormProblems>(NO_PROBLEMS);
  const [attempt, setAttempt] = useState(0);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const offered = currencies.includes(chosenCurrency) ? currencies : [chosenCurrency, ...currencies];

  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values: RecurringFormValues = {
      name: text(form, "name"),
      description: text(form, "description"),
      unit: text(form, "unit") || "unit",
      quantity: text(form, "quantity"),
      price: text(form, "price"),
      discount: text(form, "discount"),
      vatCategory: text(form, "vatCategory") || "standard",
      currency: text(form, "currency") || currency,
      interval: text(form, "interval") || "1",
      period: text(form, "period") || "month",
      startDate: text(form, "startDate"),
      endDate: text(form, "endDate"),
      paymentDays: text(form, "paymentDays"),
      autoIssue: canAutoIssue ? form.get("autoIssue") === "on" : (template?.autoIssue ?? false),
    };
    const payload = recurringPayload(values, clientId, template?.isActive ?? true);
    if (!payload.ok) {
      setProblems(payload.problems);
      setAttempt((count) => count + 1);
      return;
    }
    setProblems(NO_PROBLEMS);
    start(async () => {
      try {
        const result = template
          ? await updateRecurringAction(storeSlug, template.id, payload.input)
          : await createRecurringAction(storeSlug, payload.input);
        if (!result.ok) setProblems({ fields: {}, general: result.problems });
        else onDone?.(result.id);
      } catch {
        setProblems({
          fields: {},
          general: ["The repeating invoice could not be saved. Check your connection and try again."],
        });
      }
    });
  };

  const err = (name: string) => problems.fields[name];
  const summary = [
    ...problems.general,
    ...(Object.keys(problems.fields).length > 0 ? ["Some fields need another look. They are marked below."] : []),
  ];

  return (
    <form ref={formRef} onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-4">
      <Field label="Name" error={err("name")} hint="For you: what this repeating invoice is called in the list.">
        {(props) => (
          <input
            {...props}
            name="name"
            required
            maxLength={120}
            defaultValue={template?.name}
            className={control}
            autoComplete="off"
          />
        )}
      </Field>
      <Field
        label="Line text"
        error={err("description")}
        hint="What the invoice's line says. Empty uses the name."
      >
        {(props) => (
          <input
            {...props}
            name="description"
            maxLength={500}
            defaultValue={template && template.description !== template.name ? template.description : ""}
            className={control}
            autoComplete="off"
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Unit" error={err("unit")}>
          {(props) => (
            <select
              {...props}
              name="unit"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              className={control}
            >
              <option value="unit">Units</option>
              <option value="hour">Hours</option>
            </select>
          )}
        </Field>
        <Field
          label={unit === "hour" ? "Hours" : "Quantity"}
          error={err("quantity")}
          hint={unit === "hour" ? QUANTITY_MESSAGE.hour : undefined}
        >
          {(props) => (
            <input
              {...props}
              name="quantity"
              inputMode="decimal"
              defaultValue={template ? quantityField(template.quantityHundredths) : "1"}
              className={control}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label={`Price (${chosenCurrency})`} error={err("price")} hint="Each, without VAT.">
          {(props) => (
            <input
              {...props}
              name="price"
              inputMode="decimal"
              defaultValue={template ? moneyField(template.unitPriceMinor, template.currency) : ""}
              className={control}
              autoComplete="off"
            />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Discount (%)" error={err("discount")}>
          {(props) => (
            <input
              {...props}
              name="discount"
              inputMode="decimal"
              defaultValue={template ? bpToPercent(template.discountBp) : "0"}
              className={control}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label="VAT" error={err("vatCategory")}>
          {(props) => (
            <select {...props} name="vatCategory" defaultValue={template?.vatCategory ?? "standard"} className={control}>
              {VAT_LINE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {VAT_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Currency" error={err("currency")}>
          {(props) => (
            <select
              {...props}
              name="currency"
              value={chosenCurrency}
              onChange={(event) => setChosenCurrency(event.target.value)}
              className={control}
            >
              {offered.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Schedule</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Every" error={err("interval")}>
            {(props) => (
              <select {...props} name="interval" defaultValue={String(template?.recurrenceInterval ?? 1)} className={control}>
                {RECURRENCE_INTERVALS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Period" error={err("period")}>
            {(props) => (
              <select {...props} name="period" defaultValue={template?.recurrencePeriod ?? "month"} className={control}>
                {RECURRENCE_PERIODS.map((period) => (
                  <option key={period} value={period}>
                    {PERIOD_LABELS[period]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="First period"
            error={err("startDate")}
            hint="Every later period is counted from this day; a month's end is respected (31 Jan, 28 Feb, 31 Mar)."
          >
            {(props) => (
              <input {...props} name="startDate" type="date" defaultValue={template?.startDate ?? today} className={control} />
            )}
          </Field>
          <Field label="Last period" error={err("endDate")} hint="Empty for no end.">
            {(props) => (
              <input {...props} name="endDate" type="date" defaultValue={template?.endDate ?? ""} className={control} />
            )}
          </Field>
        </div>
        {editing && (
          <p className={hintText}>Invoices already made are left as they are. A new schedule counts from the first period.</p>
        )}
        <Field
          label="Days to pay"
          error={err("paymentDays")}
          hint="1 to 90. Empty follows the client's and the settings'."
        >
          {(props) => (
            <input
              {...props}
              name="paymentDays"
              inputMode="numeric"
              defaultValue={template?.paymentDays ?? ""}
              className={`${control} sm:max-w-32`}
              autoComplete="off"
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Sending</legend>
        {canAutoIssue ? (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="autoIssue"
              checked={auto}
              onChange={(event) => setAuto(event.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>Issue and email each invoice by itself</span>
          </label>
        ) : (
          <p className="text-sm">
            {template?.autoIssue ? "Each invoice is issued and emailed by itself." : "Each invoice is made as a draft for you to issue."}{" "}
            <span className="text-muted">Only an owner can change this.</span>
          </p>
        )}
        <p className={hintText}>
          {auto || (!canAutoIssue && template?.autoIssue)
            ? "The invoice is numbered and final the moment it is issued, and the client is emailed without anyone looking at it first. If something is missing (the client's address, a VAT number) it stays a draft."
            : "Off: a draft is made on each date and waits for you to check and issue it."}
        </p>
      </fieldset>

      <Problems messages={summary} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving …" : editing ? "Save" : "Add repeating invoice"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
