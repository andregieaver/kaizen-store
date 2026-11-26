"use client";

import { useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Modal } from "@/components/admin/modal";
import { Button } from "@/components/admin/ui/button";
import { Field, Select, TextInput } from "@/components/admin/ui/field";

export type CreateFields = {
  name: { name: string; label: string; max: number };
  date?: { name: string; label: string };
  choice?: { name: string; label: string; none: string; options: { id: string; label: string }[]; chosen?: string };
};

/**
 * The one main action of Projects and of Checklists (D903): a button that opens a short form with a name and nothing else Homer must fill in
 * (a target date for a project, a project for a list, both optional). The action moves the page to what it made.
 */
export function CreateButton({
  label,
  title,
  action,
  fields,
  submit,
  cancel,
  kind = "main",
}: {
  label: string;
  title: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  fields: CreateFields;
  submit: string;
  cancel: string;
  kind?: "main" | "secondary" | "quiet";
}) {
  const [open, setOpen] = useState(false);
  const { name, date, choice } = fields;
  return (
    <>
      <Button kind={kind} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <ActionForm action={action} className="flex flex-col gap-4 p-5">
          <Field label={name.label} required>
            {(control) => <TextInput {...control} name={name.name} maxLength={name.max} autoFocus full />}
          </Field>
          {date && <Field label={date.label}>{(control) => <TextInput {...control} type="date" name={date.name} full />}</Field>}
          {choice && choice.options.length > 0 && (
            <Field label={choice.label}>
              {(control) => (
                <Select {...control} name={choice.name} defaultValue={choice.chosen ?? ""} full>
                  <option value="">{choice.none}</option>
                  {choice.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button kind="quiet" onClick={() => setOpen(false)}>
              {cancel}
            </Button>
            <SubmitButton>{submit}</SubmitButton>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}
