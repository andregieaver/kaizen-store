"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { useAdminText } from "@/components/admin/admin-text";
import { REFUSAL_REASONS } from "@/lib/privacy-request";

import { hint, input, label } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/** Extending the answer (Art. 12(3)): once, within the first month, with a reason; the person is told by email. */
export function ExtendForm({ action }: { action: Action }) {
  const f = useAdminText("privacy").forms;
  return (
    <ActionForm action={action} className="flex flex-col gap-3" successMessage={f.extended}>
      <label className={label}>
        {f.extendQuestion}
        <textarea name="reason" required rows={3} maxLength={1000} className={`${input} py-2`} />
        <span className={hint}>{f.extendHint}</span>
      </label>
      <div>
        <SubmitButton variant="secondary">{f.extendButton}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Refusing (Art. 12(4)): a reason from a closed list and an optional note; the person is told the reasons, the right to complain and to a court. */
export function RefuseForm({ action }: { action: Action }) {
  const { forms: f, common: c } = useAdminText("privacy");
  return (
    <ActionForm action={action} className="flex flex-col gap-3" successMessage={f.refused}>
      <label className={label}>
        {f.reason}
        <select name="reason" required defaultValue="" className={input}>
          <option value="" disabled>
            {f.chooseReason}
          </option>
          {REFUSAL_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {c.refusalReasons[reason]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {c.note} <span className={hint}>{c.optional}</span>
        <textarea name="note" rows={3} maxLength={1000} className={`${input} py-2`} />
        <span className={hint}>{f.refuseHint}</span>
      </label>
      <div>
        <SubmitButton variant="secondary">{f.refuseButton}</SubmitButton>
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
export function NoDataHint({ text }: { text?: string }) {
  const staff = useAdminText("privacy").staff;
  return <p className="text-sm text-muted">{text ?? staff.noData}</p>;
}
