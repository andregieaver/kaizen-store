"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";

import { createDraftInvoiceAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-actions";
import {
  findAssignmentDraftAction,
  newInvoiceChoicesAction,
} from "@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-view-actions";
import { Modal } from "@/components/admin/modal";
import type { NewInvoiceChoices } from "@/server/work-invoice-screens";

import { Field, Problems, control, hintText, primaryButton, secondaryButton } from "./work-parts";
import { workBase } from "@/lib/work-paths";
import { useAdminText } from "@/components/admin/admin-text";

export type NewInvoiceProps = {
  storeSlug: string;
  /** The clients and assignments to choose from, when the page has them; otherwise they are read when the dialog opens. */
  choices?: NewInvoiceChoices;
  /** Start with this client chosen (a button on the client's page). */
  clientId?: string;
  /** Start with this assignment chosen (a button on the assignment). */
  assignmentId?: string;
  label?: string;
  className?: string;
  /** The dialog is open when the page is (a link that says "start an invoice"). */
  defaultOpen?: boolean;
};

/**
 * "New invoice" (docs/work.md 5.2): choose the client, optionally one of its assignments (which has at most one draft:
 * when it already has one, offer to open it instead), and the currency, which starts as the client's. Makes an empty
 * draft and opens it; the lines come from typing them or from unbilled time.
 */
export function NewInvoiceButton(props: NewInvoiceProps) {
  const tw = useAdminText("work").invoiceCreateDialog;
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={props.className ?? primaryButton}>
        {props.label ?? tw.newInvoice}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={tw.newInvoice}>
        <NewInvoiceLoader {...props} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function NewInvoiceLoader(props: NewInvoiceProps & { onClose: () => void }) {
  const tw = useAdminText("work").invoiceCreateDialog;
  const [loaded, setLoaded] = useState<NewInvoiceChoices | null>(props.choices ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const { storeSlug, choices } = props;
  useEffect(() => {
    if (choices) return;
    let cancelled = false;
    newInvoiceChoicesAction(storeSlug)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setLoaded(result.choices);
        else setProblem(result.problems.join(" "));
      })
      .catch(() => {
        if (!cancelled) setProblem(tw.theClientsCouldNot);
      });
    return () => {
      cancelled = true;
    };
  }, [storeSlug, choices, tw.theClientsCouldNot]);
  if (loaded) return <NewInvoiceForm {...props} choices={loaded} />;
  if (problem) return <Problems messages={[problem]} />;
  return <p className="text-sm text-muted">{tw.readingYourClients}</p>;
}

function NewInvoiceForm({
  storeSlug,
  choices,
  clientId,
  assignmentId,
  onClose,
}: NewInvoiceProps & { choices: NewInvoiceChoices; onClose: () => void }) {
  const tw = useAdminText("work").invoiceCreateDialog;
  const router = useRouter();
  const assignmentStart = choices.assignments.find((a) => a.id === assignmentId);
  const [client, setClient] = useState(assignmentStart?.clientId ?? clientId ?? "");
  const [assignment, setAssignment] = useState(assignmentStart?.id ?? "");
  const [currency, setCurrency] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [existing, setExisting] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [pending, start] = useTransition();

  const chosenClient = choices.clients.find((c) => c.id === client);
  const options = choices.assignments.filter((a) => a.clientId === client);
  const chosenAssignment = options.find((a) => a.id === assignment);
  const draftId = chosenAssignment?.draftInvoiceId ?? existing;
  const shown = currency ?? chosenClient?.currency ?? "";
  const currencies = shown && !choices.currencies.includes(shown) ? [shown, ...choices.currencies] : choices.currencies;
  const base = workBase(storeSlug);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    if (!chosenClient || draftId) return;
    setProblems([]);
    start(async () => {
      try {
        const result = await createDraftInvoiceAction(storeSlug, {
          clientId: chosenClient.id,
          assignmentId: assignment || null,
          currency: shown,
        });
        if (result.ok) {
          onClose();
          router.push(`${base}/invoices/${result.invoiceId}`);
        } else if (result.code === "draft_exists" && assignment) {
          const found = await findAssignmentDraftAction(storeSlug, assignment);
          if (found.ok && found.invoiceId) setExisting(found.invoiceId);
          else setProblems(result.problems);
        } else setProblems(result.problems);
      } catch {
        setProblems([tw.theInvoiceCouldNot]);
      }
    });
  };

  if (choices.clients.length === 0) {
    return (
      <p className="text-sm">
        {tw.noClientYet}{" "}
        <Link href={`${base}/clients`} className="underline">
          {tw.addAClientFirst}
        </Link>
        .
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-4">
      <Field label={tw.client} error={attempted && !chosenClient ? tw.chooseTheClientTo : undefined}>
        {(props) => (
          <select
            {...props}
            value={client}
            onChange={(event) => {
              setClient(event.target.value);
              setAssignment("");
              setCurrency(null);
              setExisting(null);
            }}
            className={control}
          >
            <option value="">{tw.chooseAClient}</option>
            {choices.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        label={tw.assignmentOptional}
        hint={tw.anInvoiceForAn}
      >
        {(props) => (
          <select
            {...props}
            value={assignment}
            disabled={!chosenClient}
            onChange={(event) => {
              setAssignment(event.target.value);
              setExisting(null);
            }}
            className={control}
          >
            <option value="">{tw.noneAnInvoiceOn}</option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.draftInvoiceId ? " (has a draft)" : ""}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={tw.currency} hint={tw.startsAsTheClient}>
        {(props) => (
          <select
            {...props}
            value={shown}
            disabled={!chosenClient}
            onChange={(event) => setCurrency(event.target.value)}
            className={`${control} sm:max-w-40`}
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        )}
      </Field>

      {draftId && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-md border border-warning-line bg-warning-soft p-3 text-sm text-warning-text"
        >
          <p>{tw.thisAssignmentAlreadyHas}</p>
          <Link href={`${base}/invoices/${draftId}`} className="self-start underline">
            {tw.openTheDraft}
          </Link>
        </div>
      )}
      <Problems messages={problems} />
      <p className={hintText}>{tw.theInvoiceGetsIts}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryButton}>
          {tw.cancel}
        </button>
        <button type="submit" disabled={pending || Boolean(draftId)} className={primaryButton}>
          {pending ? tw.starting : tw.startTheDraft}
        </button>
      </div>
    </form>
  );
}
