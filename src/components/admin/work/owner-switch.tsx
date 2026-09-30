"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";

/**
 * "Use Work in this store": a checkbox and Save, for one store (D123). Only owners can change it; for anyone else
 * the box is shown as it is, disabled. Turning it off asks nothing more: it hides Work and keeps what was saved,
 * which the note under the box says.
 */
export function WorkSwitchForm({
  action,
  storeName,
  on,
  canChange,
  note,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  storeName: string;
  on: boolean;
  canChange: boolean;
  note: string;
}) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="work" defaultChecked={on} disabled={!canChange} className="mt-0.5 size-4" />
        <span>
          Use Work in this store
          <span className="sr-only"> ({storeName})</span>
          <span className="block text-muted">{note}</span>
        </span>
      </label>
      {canChange && (
        <div>
          <SubmitButton>Save</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
