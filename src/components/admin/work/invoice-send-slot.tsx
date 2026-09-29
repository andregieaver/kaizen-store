"use client";

import { useId, useState, useTransition, type FormEvent } from "react";

import {
  hostedLinkAction,
  sendCreditNoteAction,
  sendInvoiceAction,
  sendReminderAction,
} from "@/app/admin/(gated)/[store]/work/send-actions";
import { Modal } from "@/components/admin/modal";
import { MESSAGE_MAX } from "@/lib/work-email";
import { sendFormProblems, sentText, type SendKind } from "@/lib/work-send-ui";

import { Field, Problems, control, hintText, primaryButton, secondaryButton, smallButton } from "./work-parts";

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
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={secondaryButton}>
        {sentTo ? "Send again" : "Send by email"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={sentTo ? "Send the invoice again" : "Send the invoice"}>
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
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="self-start underline">
        Send {documentNumber} by email
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Send credit note ${documentNumber}`}>
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
        setProblems(["The email could not be sent. Check your connection and try again."]);
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
        setProblems(["The link could not be read. Try again."]);
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
          Close
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-4">
      {canRemind && endpoint === "invoice" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">What to send</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name={kindName} checked={kind === "invoice"} onChange={() => setKind("invoice")} />
            The invoice
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name={kindName} checked={kind === "reminder"} onChange={() => setKind("reminder")} />
            A payment reminder
          </label>
        </fieldset>
      )}
      <Field label="To" error={shown.find((p) => p.includes("email address"))}>
        {(props) => (
          <input {...props} type="email" value={to} onChange={(e) => setTo(e.target.value)} className={control} autoComplete="off" />
        )}
      </Field>
      <Field
        label="Message (optional)"
        hint={`Goes on top of the email, in the client's language. ${MESSAGE_MAX - message.length} characters left.`}
        error={shown.find((p) => p.startsWith("Keep the message"))}
      >
        {(props) => (
          <textarea {...props} value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className={`${control} py-2`} />
        )}
      </Field>
      <p className={hintText}>
        The email links to the invoice on the store&apos;s own page. The client needs no account to open it.
      </p>
      <Problems messages={problems} />
      {link && (
        <div className="flex flex-col gap-2 text-sm">
          <input readOnly value={link} aria-label="Link to the invoice" className={control} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={copy} className={smallButton}>
            {copied ? "Copied" : "Copy the link"}
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!link ? (
          <button type="button" onClick={showLink} disabled={pending} className={smallButton}>
            Show the link
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onDone} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={primaryButton}>
            {pending ? "Sending …" : endpoint === "invoice" && kind === "reminder" ? "Send reminder" : again ? "Send again" : "Send"}
          </button>
        </div>
      </div>
    </form>
  );
}
