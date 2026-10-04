"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * *Check again* on the Waiting tab (D159): the same job the five-minute run does, for this store, now. It issues the invoices whose cause
 * has been put right and the credit notes that waited for them, and says how many. Staff who may change orders only.
 */
export function CheckAgainForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} successMessage="Checked." className="flex flex-col gap-2">
      <div>
        <SubmitButton>Check again</SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * *Try again* for a document whose PDF could not be made after several tries: forgets the failures, and the PDF is made on the job's next
 * run or the next download. The document itself is unaffected: its number and content were frozen when it was issued.
 */
export function RetryPdfForm({ action, type, id }: { action: Action; type: "invoice" | "credit_note"; id: string }) {
  return (
    <ActionForm action={action} successMessage="It will be tried again." className="flex flex-col gap-1">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={id} />
      <div>
        <SubmitButton variant="secondary">Try again</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** *Send again* on the order's Documents card: the order's own address, never one typed here. */
export function SendAgainForm({ action, label }: { action: Action; label: string }) {
  return (
    <ActionForm action={action} successMessage="Sent." className="flex flex-col gap-1">
      <div>
        <SubmitButton variant="secondary">{label}</SubmitButton>
      </div>
    </ActionForm>
  );
}
