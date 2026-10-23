"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  deleteRecurringAction,
  generateRecurringNowAction,
  issueRecurringNowAction,
  restoreRecurringPeriodAction,
  setRecurringActiveAction,
  skipRecurringPeriodAction,
} from "@/app/admin/(gated)/(owner)/account/work/s/[store]/recurring-actions";
import { formatDay } from "@/lib/work-dates";

import { FormDialogButton } from "./client-actions";
import type { RecurringInvoice } from "@/server/work-recurring";

import { RecurringForm, type RecurringFormProps } from "./recurring-form";
import { Problems, dangerLink, primaryButton, secondaryButton, smallButton } from "./work-parts";
import { workBase } from "@/lib/work-paths";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

type SharedForm = Omit<RecurringFormProps, "template" | "onDone" | "onCancel">;

/** "Add repeating invoice": the form in a dialog. Saving refreshes the page behind it. */
export function NewRecurringButton(props: SharedForm) {
  const tw = useAdminText("work").recurringControls;
  return (
    <FormDialogButton label={tw.addRepeatingInvoice} title={tw.newRepeatingInvoice} primary>
      {(close) => <RecurringForm {...props} onCancel={close} onDone={close} />}
    </FormDialogButton>
  );
}

export type OpenPeriod = { period: string; invoiceId: string | null; overdueForJob: boolean };

export type TemplateActionsProps = {
  storeSlug: string;
  template: RecurringInvoice;
  form: SharedForm;
  locale: string;
  /** Due periods with no invoice or only a draft, oldest first. */
  open: OpenPeriod[];
};

/**
 * What can be done with one repeating invoice: change it, pause or start it, delete it while it has made
 * nothing, and for each due period that has no invoice or only a draft: make the draft, issue it, or skip
 * the period. Issuing is final, so it asks first (and whether to email). Every result is said here, and
 * the page behind is refreshed by the action.
 */
export function TemplateActions({ storeSlug, template, form, locale, open }: TemplateActionsProps) {
  const tw = useAdminText("work").recurringControls;
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [emailIt, setEmailIt] = useState(true);
  const missing = open.filter((o) => o.invoiceId === null);

  const run = (job: () => Promise<{ ok: boolean; problems?: string[] } & Record<string, unknown>>, done?: (r: Record<string, unknown>) => string | null) =>
    start(async () => {
      setProblems([]);
      setNotice(null);
      try {
        const result = await job();
        if (!result.ok) setProblems(result.problems ?? [tw.thatDidNotWork]);
        else setNotice(done?.(result) ?? null);
      } catch {
        setProblems([tw.thatCouldNotBe]);
      }
      setConfirming(null);
    });

  const issued = (result: Record<string, unknown>): string =>
    `${fillWords(tw.issuedAs, { number: String(result.documentNumber) })} ${
      result.emailed
        ? tw.theClientWasEmailed
        : result.emailReason === "not_requested"
          ? tw.itWasNotEmailed
          : tw.itCouldNotBe
    }`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FormDialogButton label={tw.edit} title={fillWords(tw.editName, { name: template.name })}>
          {(close) => <RecurringForm {...form} template={template} onCancel={close} onDone={close} />}
        </FormDialogButton>
        <button
          type="button"
          disabled={pending}
          className={secondaryButton}
          onClick={() => run(() => setRecurringActiveAction(storeSlug, template.id, !template.isActive))}
        >
          {template.isActive ? "Pause" : tw.startAgain}
        </button>
        {missing.length > 0 && (
          <button
            type="button"
            disabled={pending}
            className={secondaryButton}
            onClick={() =>
              run(
                () => generateRecurringNowAction(storeSlug, template.id),
                () => tw.theDraftIsMade,
              )
            }
          >
            {tw.generateNow}
          </button>
        )}
      </div>

      {open.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={tw.periodsToInvoice}>
          {open.map((o) => (
            <li key={o.period} className="flex flex-col gap-2 rounded-md border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  <span className="font-medium">{formatDay(o.period, locale)}</span>{" "}
                  <span className="text-muted">
                    {o.invoiceId
                      ? "draft waiting to be issued"
                      : o.overdueForJob
                        ? "no invoice (older than 40 days, so it is not made by itself)"
                        : "no invoice yet"}
                  </span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {o.invoiceId ? (
                    <Link href={`${workBase(storeSlug)}/invoices/${o.invoiceId}`} className={smallButton}>
                      {tw.openTheDraft}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      className={smallButton}
                      onClick={() =>
                        run(
                          () => generateRecurringNowAction(storeSlug, template.id, o.period),
                          () => tw.theDraftIsMade,
                        )
                      }
                    >
                      {tw.generateDraft}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    className={smallButton}
                    onClick={() => setConfirming(confirming === o.period ? null : o.period)}
                    aria-expanded={confirming === o.period}
                  >
                    {tw.issueNow}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className={dangerLink}
                    onClick={() => run(() => skipRecurringPeriodAction(storeSlug, template.id, o.period), () => tw.thatPeriodIsSkipped)}
                  >
                    {o.invoiceId ? tw.skipAndDeleteThe : tw.skipThisPeriod}
                  </button>
                </div>
              </div>
              {confirming === o.period && (
                <div className="flex flex-col gap-2 rounded-md bg-sunken p-3">
                  <p className="text-sm">
                    {tw.issuingGivesTheInvoice}
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={emailIt} onChange={(event) => setEmailIt(event.target.checked)} className="size-4" />
                    {tw.emailItToThe}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      className={primaryButton}
                      onClick={() => run(() => issueRecurringNowAction(storeSlug, template.id, o.period, emailIt), issued)}
                    >
                      {pending ? tw.issuing : tw.issueInvoice}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className={secondaryButton}>
                      {tw.cancel}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {template.skippedPeriods.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">{fillWords(tw.skippedPeriods, { count: template.skippedPeriods.length })}</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {template.skippedPeriods.map((period) => (
              <li key={period} className="flex flex-wrap items-center gap-3">
                <span>{formatDay(period, locale)}</span>
                <button
                  type="button"
                  disabled={pending}
                  className="text-sm underline disabled:opacity-50"
                  onClick={() =>
                    run(() => restoreRecurringPeriodAction(storeSlug, template.id, period), () => tw.thePeriodIsBack)
                  }
                >
                  {tw.restore}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <Problems messages={problems} />
    </div>
  );
}

/** Deletes a repeating invoice that has made nothing (one that has can only be paused). */
export function DeleteRecurringButton({ storeSlug, templateId, name }: { storeSlug: string; templateId: string; name: string }) {
  const tw = useAdminText("work").recurringControls;
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className={dangerLink}
        onClick={() => {
          if (!window.confirm(`Delete the repeating invoice "${name}"?`)) return;
          start(async () => {
            setProblems([]);
            try {
              const result = await deleteRecurringAction(storeSlug, templateId);
              if (!result.ok) setProblems(result.problems);
            } catch {
              setProblems([tw.itCouldNotBe2]);
            }
          });
        }}
      >
        {tw.delete}
      </button>
      <Problems messages={problems} />
    </span>
  );
}
