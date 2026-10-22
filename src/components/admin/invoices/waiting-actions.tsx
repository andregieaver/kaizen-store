"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { useAdminText } from "@/components/admin/admin-text";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * *Check again* on the Waiting tab (D159): the same job the five-minute run does, for this store, now. It issues the invoices whose cause
 * has been put right and the credit notes that waited for them, and says how many. Staff who may change orders only.
 */
export function CheckAgainForm({ action }: { action: Action }) {
  const f = useAdminText("invoices").forms;
  return (
    <ActionForm action={action} successMessage={f.checked} className="flex flex-col gap-2">
      <div>
        <SubmitButton>{f.checkAgain}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * *Try again* for a document whose PDF could not be made after several tries: forgets the failures, and the PDF is made on the job's next
 * run or the next download. The document itself is unaffected: its number and content were frozen when it was issued.
 */
export function RetryPdfForm({ action, type, id }: { action: Action; type: "invoice" | "credit_note"; id: string }) {
  const f = useAdminText("invoices").forms;
  return (
    <ActionForm action={action} successMessage={f.willRetry} className="flex flex-col gap-1">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={id} />
      <div>
        <SubmitButton variant="secondary">{f.tryAgain}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** *Send again* on the order's Documents card: the order's own address, never one typed here. */
export function SendAgainForm({ action, label }: { action: Action; label: string }) {
  const f = useAdminText("invoices").forms;
  return (
    <ActionForm action={action} successMessage={f.sent} className="flex flex-col gap-1">
      <div>
        <SubmitButton variant="secondary">{label}</SubmitButton>
      </div>
    </ActionForm>
  );
}
