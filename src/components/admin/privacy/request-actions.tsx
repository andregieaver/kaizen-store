"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { REFUSAL_REASONS, REFUSAL_REASON_LABELS } from "@/lib/privacy-request";
import { STAFF_TEXT } from "@/lib/privacy-text";

import { hint, input, label } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/** Extending the answer (Art. 12(3)): once, within the first month, with a reason; the person is told by email. */
export function ExtendForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3" successMessage="The answer is extended. The person has been told.">
      <label className={label}>
        Why is the answer extended?
        <textarea name="reason" required rows={3} maxLength={1000} className={`${input} py-2`} />
        <span className={hint}>The person is emailed this reason. You may extend once, within the first month, by up to two further months.</span>
      </label>
      <div>
        <SubmitButton variant="secondary">Extend and tell the person</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Refusing (Art. 12(4)): a reason from a closed list and an optional note; the person is told the reasons, the right to complain and to a court. */
export function RefuseForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3" successMessage="The request is refused. The person has been told.">
      <label className={label}>
        Reason
        <select name="reason" required defaultValue="" className={input}>
          <option value="" disabled>
            Choose a reason
          </option>
          {REFUSAL_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {REFUSAL_REASON_LABELS[reason]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Note <span className={hint}>(optional)</span>
        <textarea name="note" rows={3} maxLength={1000} className={`${input} py-2`} />
        <span className={hint}>The person is emailed the reason and this note, with the right to complain to the supervisory authority.</span>
      </label>
      <div>
        <SubmitButton variant="secondary">Refuse and tell the person</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** A step that needs no input: one button and its outcome. */
export function StepForm({ action, children, successMessage }: { action: Action; children: string; successMessage: string }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-2" successMessage={successMessage}>
      <div>
        <SubmitButton variant="secondary">{children}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Close a request as "no data held": only when the store holds nothing about the person. */
export function NoDataHint() {
  return <p className="text-sm text-muted">{STAFF_TEXT.noData}</p>;
}
