"use client";

import { useId, useState, useTransition, type FormEvent } from "react";

import {
  hostedLinkAction,
  sendCreditNoteAction,
  sendInvoiceAction,
  sendReminderAction,
} from "@/app/admin/(gated)/(owner)/account/work/s/[store]/send-actions";
import { Modal } from "@/components/admin/modal";
import { MESSAGE_MAX } from "@/lib/work-email";
import { sendFormProblems, sentText, type SendKind } from "@/lib/work-send-ui";

import { Field, Problems, control, hintText, primaryButton, secondaryButton, smallButton } from "./work-parts";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

export type SendInvoiceSlotProps = {
  storeSlug: string;
  invoiceId: string;
  /** The address the invoice was issued to, else the client's billing address; the person may change it. */
  clientEmail: string | null;
  /** Where it was sent before, when it was: the button then says "Send again". */
  sentTo?: string | null;
  /** The invoice is issued and something is still to pay, so a payment reminder makes sense. */
  canRemind?: boolean;
};

/**
 * "Send by email" on an issued invoice (docs/work.md 4.7, WP7b): a dialog with the address (the client's, changeable), an
 * optional note that goes on top of the email, the choice between the invoice and a payment reminder (when something is
 * still to pay), and the result. Sending is the server's (`send-actions.ts`): the email is kept in the email log first,
 * so where email is not set up yet it says the invoice was kept, not sent. A copy of the hosted link is offered for
 * sending it another way.
 */
export function SendInvoiceSlot({ storeSlug, invoiceId, clientEmail, sentTo = null, canRemind = false }: SendInvoiceSlotProps) {
  const tw = useAdminText("work").invoiceSendSlot;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={secondaryButton}>
        {sentTo ? tw.sendAgain : tw.sendByEmail}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={sentTo ? tw.sendTheInvoiceAgain : tw.sendTheInvoice}>
        <SendForm
          endpoint="invoice"
          storeSlug={storeSlug}
          documentId={invoiceId}
          invoiceId={invoiceId}
          address={sentTo ?? clientEmail ?? ""}
          again={sentTo !== null}
          canRemind={canRemind}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

export type SendCreditNoteButtonProps = {
  storeSlug: string;
  creditNoteId: string;
  documentNumber: string;
  clientEmail: string | null;
};

/** "Send by email" on one credit note of an issued invoice. */
export function SendCreditNoteButton({ storeSlug, creditNoteId, documentNumber, clientEmail }: SendCreditNoteButtonProps) {
  const tw = useAdminText("work").invoiceSendSlot;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="self-start underline">
        {fillWords(tw.sendNumberByEmail, { number: documentNumber })}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={fillWords(tw.sendCreditNote, { number: documentNumber })}>
        <SendForm
          endpoint="credit"
          storeSlug={storeSlug}
          documentId={creditNoteId}
          invoiceId={null}
          address={clientEmail ?? ""}
          again
          canRemind={false}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

function SendForm({
  endpoint,
  storeSlug,
  documentId,
  invoiceId,
  address,
  again,
  canRemind,
  onDone,
}: {
  endpoint: "invoice" | "credit";
  storeSlug: string;
  documentId: string;
  invoiceId: string | null;
  address: string;
  again: boolean;
  canRemind: boolean;
  onDone: () => void;
}) {
  const tw = useAdminText("work").invoiceSendSlot;
  const [to, setTo] = useState(address);
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<SendKind>("invoice");
  const [attempted, setAttempted] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const kindName = useId();

  const checked = sendFormProblems({ to, message, kind });
  const shown = attempted ? checked : [];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    if (checked.length > 0) return;
    setProblems([]);
    start(async () => {
      try {
        const input = { id: documentId, to: to.trim(), message: message.trim() || null, again };
        const result =
          endpoint === "credit"
            ? await sendCreditNoteAction(storeSlug, input)
            : kind === "reminder"
              ? await sendReminderAction(storeSlug, input)
              : await sendInvoiceAction(storeSlug, input);
        if (result.ok) setDone(sentText(endpoint === "invoice" ? kind : "invoice", result.outcome ?? undefined, result.to));
        else setProblems(result.problems);
      } catch {
        setProblems([tw.theEmailCouldNot]);
      }
    });
  };

  const showLink = () =>
    start(async () => {
      try {
        const result = await hostedLinkAction(storeSlug, invoiceId ?? documentId);
        if (result.ok) setLink(result.url);
        else setProblems(result.problems);
      } catch {
        setProblems([tw.theLinkCouldNot]);
      }
    });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status">{done}</p>
        <button type="button" onClick={onDone} className={primaryButton}>
          {tw.close}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-4">
      {canRemind && endpoint === "invoice" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{tw.whatToSend}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name={kindName} checked={kind === "invoice"} onChange={() => setKind("invoice")} />
            {tw.theInvoice}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name={kindName} checked={kind === "reminder"} onChange={() => setKind("reminder")} />
            {tw.aPaymentReminder}
          </label>
        </fieldset>
      )}
      <Field label={tw.to} error={shown.find((p) => p.includes("email address"))}>
        {(props) => (
          <input {...props} type="email" value={to} onChange={(e) => setTo(e.target.value)} className={control} autoComplete="off" />
        )}
      </Field>
      <Field
        label={tw.messageOptional}
        hint={fillWords(tw.goesOnTop, { left: MESSAGE_MAX - message.length })}
        error={shown.find((p) => p.startsWith(tw.keepTheMessage))}
      >
        {(props) => (
          <textarea {...props} value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className={`${control} py-2`} />
        )}
      </Field>
      <p className={hintText}>
        {tw.theEmailLinksTo}
      </p>
      <Problems messages={problems} />
      {link && (
        <div className="flex flex-col gap-2 text-sm">
          <input readOnly value={link} aria-label={tw.linkToTheInvoice} className={control} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={copy} className={smallButton}>
            {copied ? "Copied" : tw.copyTheLink}
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!link ? (
          <button type="button" onClick={showLink} disabled={pending} className={smallButton}>
            {tw.showTheLink}
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onDone} className={secondaryButton}>
            {tw.cancel}
          </button>
          <button type="submit" disabled={pending} className={primaryButton}>
            {pending ? tw.sending : endpoint === "invoice" && kind === "reminder" ? tw.sendReminder : again ? tw.sendAgain : "Send"}
          </button>
        </div>
      </div>
    </form>
  );
}
