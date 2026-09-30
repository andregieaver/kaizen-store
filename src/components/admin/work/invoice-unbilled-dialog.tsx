"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { generateLinesFromTimeAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-actions";
import { unbilledTimeAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-view-actions";
import { Modal } from "@/components/admin/modal";
import { formatMoney } from "@/lib/money";
import { formatDay, isDay } from "@/lib/work-dates";
import { formatDuration } from "@/lib/work-time";
import type { GeneratedLines, UnbilledGroup } from "@/server/work-invoices";

import { Field, Problems, control, hintText, primaryButton, secondaryButton } from "./work-parts";

export type UnbilledDialogProps = {
  open: boolean;
  onClose: () => void;
  storeSlug: string;
  invoiceId: string;
  clientId: string;
  /** The invoice's assignment: it takes only that one's time. Null for an invoice on its own. */
  assignmentId: string | null;
  /** The invoice's assignment bills a fixed fee: adding puts the fee on the invoice as one line, with or without time. */
  fixedFee?: boolean;
  currency: string;
  locale: string;
  /** Saves what has been typed, so the lines the time joins are the ones on screen. */
  beforeAdd: () => Promise<boolean>;
};

/**
 * "Add unbilled time" (docs/work.md 4.6): shows the billable time nothing has invoiced yet, by assignment and task,
 * with what it comes to at the assignment's rate, and after a yes makes a line for each task (or adds to the one it
 * has), attaching the time so it can be billed once only. Say what was done, and anything to know (a missing rate, a
 * fixed fee that is already billed).
 */
export function UnbilledTimeDialog(props: UnbilledDialogProps) {
  return (
    <Modal open={props.open} onClose={props.onClose} title="Add unbilled time" wide>
      <UnbilledBody {...props} />
    </Modal>
  );
}

function UnbilledBody({
  storeSlug,
  invoiceId,
  clientId,
  assignmentId,
  currency,
  locale,
  beforeAdd,
  fixedFee = false,
  onClose,
}: UnbilledDialogProps) {
  const [groups, setGroups] = useState<UnbilledGroup[] | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState<GeneratedLines | null>(null);
  const [pending, start] = useTransition();

  const fromDay = isDay(from) ? from : undefined;
  const toDay = isDay(to) ? to : undefined;
  const rangeProblem =
    (from && !isDay(from)) || (to && !isDay(to))
      ? "Give the period as dates."
      : from && to && to < from
        ? "The period ends before it starts."
        : null;

  useEffect(() => {
    if (rangeProblem) return;
    let cancelled = false;
    unbilledTimeAction(storeSlug, { clientId, assignmentId: assignmentId ?? undefined, from: fromDay, to: toDay })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setGroups(result.groups);
          setLoadProblem(null);
        } else setLoadProblem(result.problems.join(" "));
      })
      .catch(() => {
        if (!cancelled) setLoadProblem("The unbilled time could not be read. Check your connection and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [storeSlug, clientId, assignmentId, fromDay, toDay, rangeProblem]);

  const byAssignment = useMemo(() => {
    const map = new Map<string, { name: string; billing: UnbilledGroup["billingType"]; groups: UnbilledGroup[] }>();
    for (const group of groups ?? []) {
      const entry = map.get(group.assignmentId) ?? {
        name: group.assignmentName,
        billing: group.billingType,
        groups: [],
      };
      entry.groups.push(group);
      map.set(group.assignmentId, entry);
    }
    return [...map.entries()];
  }, [groups]);

  const chosen = byAssignment.filter(([id]) => !unchecked.has(id));
  const chosenGroups = chosen.flatMap(([, a]) => a.groups);
  const minutes = chosenGroups.reduce((sum, g) => sum + g.minutes, 0);
  const entries = chosenGroups.reduce((sum, g) => sum + g.entries, 0);
  const amountMinor = chosenGroups.reduce((sum, g) => sum + g.amountMinor, 0);
  const choosing = assignmentId === null && byAssignment.length > 1;

  const add = () => {
    setProblems([]);
    start(async () => {
      try {
        if (!(await beforeAdd())) {
          setProblems(["Fix what is marked on the invoice first, so its changes can be saved."]);
          return;
        }
        const result = await generateLinesFromTimeAction(storeSlug, invoiceId, {
          assignmentIds: choosing && chosen.length < byAssignment.length ? chosen.map(([id]) => id) : null,
          from: fromDay ?? null,
          to: toDay ?? null,
        });
        if (result.ok) setDone(result);
        else setProblems(result.problems);
      } catch {
        setProblems(["The time could not be added. Check your connection and try again."]);
      }
    });
  };

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-sm">
          {done.added === 0 && done.updated === 0
            ? "No lines were changed."
            : `${done.added > 0 ? `${done.added} ${done.added === 1 ? "line" : "lines"} added` : ""}${done.added > 0 && done.updated > 0 ? " and " : ""}${done.updated > 0 ? `${done.updated} ${done.updated === 1 ? "line" : "lines"} updated` : ""}.`}{" "}
          {done.attachedEntries > 0 &&
            `${done.attachedEntries} time ${done.attachedEntries === 1 ? "entry" : "entries"} now belong to this invoice.`}
        </p>
        {done.notes.length > 0 && (
          <ul className="list-disc pl-5 text-sm">
            {done.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={primaryButton}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      <p className={hintText}>
        Billable time that no invoice has taken yet. Adding it makes a line for each task, priced at the
        assignment&apos;s rate, and attaches the time to it so it cannot be billed twice. Hours are rounded to two
        decimals (20 minutes is 0.33 h).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From date (optional)" error={from && !isDay(from) ? "Give the date." : undefined}>
          {(props) => (
            <input
              {...props}
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className={control}
            />
          )}
        </Field>
        <Field label="To date (optional)" error={rangeProblem ?? undefined}>
          {(props) => (
            <input
              {...props}
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className={control}
            />
          )}
        </Field>
      </div>

      {loadProblem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {loadProblem}
        </p>
      )}
      {groups === null && !loadProblem && <p className="text-sm text-muted">Reading your unbilled time …</p>}
      {groups !== null && groups.length === 0 && (
        <p className="text-sm text-muted">
          {fixedFee
            ? "This assignment bills a fixed fee. Adding puts the fee on the invoice as one line, once."
            : `There is no unbilled time for this ${assignmentId ? "assignment" : "client"}.`}
        </p>
      )}

      {byAssignment.map(([id, assignment]) => (
        <fieldset key={id} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">
            {choosing ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!unchecked.has(id)}
                  onChange={(event) => {
                    const next = new Set(unchecked);
                    if (event.target.checked) next.delete(id);
                    else next.add(id);
                    setUnchecked(next);
                  }}
                  className="size-4"
                />
                {assignment.name}
              </label>
            ) : (
              assignment.name
            )}
            {assignment.billing === "fixed_fee" && (
              <span className="font-normal text-muted"> (fixed fee: one line at its fee)</span>
            )}
          </legend>
          <ul className="flex flex-col gap-1 text-sm">
            {assignment.groups.map((group) => (
              <li
                key={`${group.assignmentId}:${group.taskId ?? "none"}`}
                className="flex flex-wrap justify-between gap-x-4"
              >
                <span>
                  {group.taskTitle ?? "No task"}{" "}
                  <span className="text-xs text-muted">
                    {group.entries} {group.entries === 1 ? "entry" : "entries"}, {formatDay(group.oldest, locale)}
                    {group.newest !== group.oldest ? ` to ${formatDay(group.newest, locale)}` : ""}
                  </span>
                </span>
                <span className="tabular-nums">
                  {formatDuration(group.minutes)}
                  {group.billingType === "hourly" &&
                    ` at ${formatMoney(group.rateMinor, currency, locale)}, ${formatMoney(group.amountMinor, currency, locale)}`}
                </span>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}

      {chosenGroups.length > 0 && (
        <p className="text-sm" aria-live="polite">
          {entries} {entries === 1 ? "entry" : "entries"}, {formatDuration(minutes)}, about{" "}
          {formatMoney(amountMinor, currency, locale)} without VAT will be added.
        </p>
      )}
      <Problems messages={problems} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryButton}>
          Cancel
        </button>
        <button
          type="button"
          onClick={add}
          disabled={pending || (chosenGroups.length === 0 && !(fixedFee && groups !== null)) || rangeProblem !== null}
          className={primaryButton}
        >
          {pending ? "Adding …" : "Add to the invoice"}
        </button>
      </div>
    </div>
  );
}
