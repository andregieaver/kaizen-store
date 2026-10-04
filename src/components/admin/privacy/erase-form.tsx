"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { STAFF_TEXT } from "@/lib/privacy-text";

import { card, hint, input, label } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * Step 2 of the erase page (wave 1, 1g, D162): the staff member types the customer's email address (or the word ERASE for a customer
 * with none) and presses the button. A wrong confirmation changes nothing; the owners are told when it runs.
 */
export function EraseForm({ email, action }: { email: string | null; action: Action }) {
  return (
    <section aria-labelledby="erase-confirm" className={card}>
      <h2 id="erase-confirm" className="font-medium">
        Confirm
      </h2>
      <ActionForm action={action} className="flex flex-col gap-3" successMessage="Done.">
        <label className={label}>
          {email ? (
            <>
              Type <span className="font-mono">{email}</span> to confirm
            </>
          ) : (
            <>
              Type <span className="font-mono">ERASE</span> to confirm
            </>
          )}
          <span className={hint}>{STAFF_TEXT.eraseConfirm}</span>
          <input name="confirm" required autoComplete="off" spellCheck={false} className={input} />
        </label>
        <div>
          <SubmitButton>Erase personal data</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}
