"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { useAdminText } from "@/components/admin/admin-text";

import { card, hint, input, label } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * Step 2 of the erase page (wave 1, 1g, D162): the staff member types the customer's email address (or the word ERASE for a customer
 * with none) and presses the button. A wrong confirmation changes nothing; the owners are told when it runs.
 */
export function EraseForm({ email, action }: { email: string | null; action: Action }) {
  const { erase: w, staff, common: c } = useAdminText("privacy");
  const [before, after] = w.typeToConfirm.split("{value}");
  return (
    <section aria-labelledby="erase-confirm" className={card}>
      <h2 id="erase-confirm" className="text-title text-ink">
        {w.confirm}
      </h2>
      <ActionForm action={action} className="flex flex-col gap-3" successMessage={w.done}>
        <label className={label}>
          <span>
            {before}
            <span className="font-mono">{email ?? "ERASE"}</span>
            {after}
          </span>
          <span className={hint}>{staff.eraseConfirm}</span>
          <input name="confirm" required autoComplete="off" spellCheck={false} className={input} />
        </label>
        <div>
          <SubmitButton>{c.eraseData}</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}
