"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { createAssignmentAction, updateAssignmentAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/actions";
import type { EstimateAlertSettings } from "@/lib/work-estimate";
import { formatMoney } from "@/lib/money";
import {
  ASSIGNMENT_STATUS_LABELS,
  BILLING_TYPE_LABELS,
  NO_PROBLEMS,
  assignmentPayload,
  estimateField,
  moneyField,
  type AssignmentFormValues,
  type FormProblems,
} from "@/lib/work-ui";
import type { WorkAssignment } from "@/server/work";

import { Field, Problems, control, hintText, primaryButton, secondaryButton } from "./work-parts";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

export type AssignmentFormProps = {
  storeSlug: string;
  clientId: string;
  /** The client's currency: the rate and the fee are in it. */
  currency: string;
  /** The client's hourly rate, to say what an assignment without one of its own is billed at. */
  clientRateMinor: number | null;
  locale: string;
  /** The assignment being changed; none makes a new one. */
  assignment?: WorkAssignment;
  /** What a new assignment's warnings start as (the Work settings'). */
  estimateAlert: EstimateAlertSettings;
  /** Clients it could move to, offered only when it has no time and no invoices. */
  moveTo?: { id: string; name: string }[];
  onDone?: (id: string) => void;
  onCancel?: () => void;
};

const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * An assignment: the job for a client, billed by the hour or as a fixed fee,
 * with an estimate and when to be warned as it runs out. It has no invoice of
 * its own: invoices are drafted from its time. Sent as JSON and checked by
 * `assignmentInput` in the browser and again on the server.
 */
export function AssignmentForm({
  storeSlug,
  clientId,
  currency,
  clientRateMinor,
  locale,
  assignment,
  estimateAlert,
  moveTo,
  onDone,
  onCancel,
}: AssignmentFormProps) {
  const tw = useAdminText("work").assignmentForm;
  const tl = useAdminText("work").labels;
  const editing = assignment !== undefined;
  const [billingType, setBillingType] = useState<string>(assignment?.billingType ?? "hourly");
  const [problems, setProblems] = useState<FormProblems>(NO_PROBLEMS);
  const [attempt, setAttempt] = useState(0);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const alertMinutes = assignment ? assignment.estimateAlertMinutes : estimateAlert.minutes;
  const popup = assignment ? assignment.estimateAlertPopup : estimateAlert.popup;
  const sound = assignment ? assignment.estimateAlertSound : estimateAlert.sound;

  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values: AssignmentFormValues = {
      clientId: text(form, "clientId") || clientId,
      name: text(form, "name"),
      status: text(form, "status") || "active",
      billingType: text(form, "billingType") || "hourly",
      hourlyRate: text(form, "hourlyRate"),
      fixedAmount: text(form, "fixedAmount"),
      estimate: text(form, "estimate"),
      startDate: text(form, "startDate"),
      endDate: text(form, "endDate"),
      alertMinutes: text(form, "alertMinutes"),
      alertPopup: form.get("alertPopup") === "on",
      alertSound: form.get("alertSound") === "on",
    };
    const payload = assignmentPayload(values, currency);
    if (!payload.ok) {
      setProblems(payload.problems);
      setAttempt((count) => count + 1);
      return;
    }
    setProblems(NO_PROBLEMS);
    start(async () => {
      try {
        if (assignment) {
          const result = await updateAssignmentAction(storeSlug, assignment.id, payload.input);
          if (!result.ok) setProblems({ fields: {}, general: result.problems });
          else onDone?.(assignment.id);
        } else {
          const result = await createAssignmentAction(storeSlug, payload.input);
          if (!result.ok) setProblems({ fields: {}, general: result.problems });
          else onDone?.(result.id);
        }
      } catch {
        setProblems({
          fields: {},
          general: [tw.theAssignmentCouldNot],
        });
      }
    });
  };

  const err = (name: string) => problems.fields[name];
  const summary = [
    ...problems.general,
    ...(Object.keys(problems.fields).length > 0 ? [tw.someFieldsNeedAnother] : []),
  ];
  const clientRate = clientRateMinor === null ? null : formatMoney(clientRateMinor, currency, locale);

  return (
    <form ref={formRef} onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-4">
      <Field label={tw.name} error={err("name")}>
        {(props) => (
          <input
            {...props}
            name="name"
            required
            maxLength={200}
            defaultValue={assignment?.name}
            className={control}
            autoComplete="off"
          />
        )}
      </Field>
      {moveTo && moveTo.length > 0 && (
        <Field
          label={tw.client}
          error={err("clientId")}
          hint={tw.anAssignmentWithNo}
        >
          {(props) => (
            <select {...props} name="clientId" defaultValue={clientId} className={control}>
              {moveTo.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tw.billing} error={err("billingType")}>
          {(props) => (
            <select
              {...props}
              name="billingType"
              value={billingType}
              onChange={(event) => setBillingType(event.target.value)}
              className={control}
            >
              {(Object.keys(BILLING_TYPE_LABELS) as (keyof typeof BILLING_TYPE_LABELS)[]).map((value) => (
                <option key={value} value={value}>
                  {tl.billingType[value]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={tw.status} error={err("status")}>
          {(props) => (
            <select {...props} name="status" defaultValue={assignment?.status ?? "active"} className={control}>
              {(Object.keys(ASSIGNMENT_STATUS_LABELS) as (keyof typeof ASSIGNMENT_STATUS_LABELS)[]).map((value) => (
                <option key={value} value={value}>
                  {tl.assignmentStatus[value]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {billingType === "fixed_fee" ? (
        <Field
          label={fillWords(tw.fixedFeeIn, { currency })}
          error={err("fixedAmount")}
          hint={tw.withoutVatBilledOnce}
        >
          {(props) => (
            <input
              {...props}
              name="fixedAmount"
              inputMode="decimal"
              defaultValue={moneyField(assignment?.fixedAmountMinor, currency)}
              className={control}
              autoComplete="off"
            />
          )}
        </Field>
      ) : (
        <Field
          label={fillWords(tw.hourlyRateIn, { currency })}
          error={err("hourlyRate")}
          hint={
            clientRate
              ? fillWords(tw.emptyBillsClientRate, { rate: clientRate })
              : tw.withoutVatTheClient
          }
        >
          {(props) => (
            <input
              {...props}
              name="hourlyRate"
              inputMode="decimal"
              defaultValue={moneyField(assignment?.hourlyRateMinor, currency)}
              className={control}
              autoComplete="off"
            />
          )}
        </Field>
      )}
      <Field label={tw.estimate} error={err("estimate")} hint={tw.hoursOr1h301}>
        {(props) => (
          <input
            {...props}
            name="estimate"
            defaultValue={estimateField(assignment?.estimatedMinutes)}
            className={`${control} sm:max-w-48`}
            autoComplete="off"
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tw.start} error={err("startDate")}>
          {(props) => (
            <input
              {...props}
              name="startDate"
              type="date"
              defaultValue={assignment?.startDate ?? ""}
              className={control}
            />
          )}
        </Field>
        <Field label={tw.end} error={err("endDate")}>
          {(props) => (
            <input {...props} name="endDate" type="date" defaultValue={assignment?.endDate ?? ""} className={control} />
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
        <legend className="px-1 text-sm font-medium">{tw.estimateWarnings}</legend>
        <p className={hintText}>
          {tw.whileATimerRuns}
        </p>
        <Field
          label={tw.warnThisManyMinutes}
          error={err("alertMinutes")}
          hint={tw.emptyForNoWarnings}
        >
          {(props) => (
            <input
              {...props}
              name="alertMinutes"
              inputMode="numeric"
              defaultValue={alertMinutes ?? ""}
              className={`${control} sm:max-w-32`}
              autoComplete="off"
            />
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="alertPopup" defaultChecked={popup} className="size-4" />
          {tw.showAMessage}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="alertSound" defaultChecked={sound} className="size-4" />
          {tw.playAChime}
        </label>
      </fieldset>

      <Problems messages={summary} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? tw.saving : editing ? tw.saveAssignment : tw.addAssignment}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButton}>
            {tw.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
