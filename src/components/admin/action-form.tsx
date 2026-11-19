"use client";

import { submitClass } from "@/lib/submit-class";
import { startTransition, useActionState, useContext, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import type { FormAnswer } from "@/lib/form-problems";

import { useCommonText } from "./admin-text-context";
import { useEditedSince, useProblemsAtFields, useSubmitterMark } from "./form-answer";
import { FormWorkContext } from "./form-work";

/** `fields` ties a problem to the field it is about, by the field's name (`formProblems()`, PSI ACC-05). */
export type FormState = FormAnswer;

export const idle: FormState = { status: "idle", messages: [] };

/**
 * A form bound to a server action, showing its outcome where it belongs (code review step 1.15, D829).
 *
 * With JavaScript, the action is called from a transition rather than by the form itself, so React does not clear the fields afterwards: a
 * form that fails validation keeps what was typed. Without JavaScript it still posts. While it works the form is `aria-busy`, takes no
 * second submission and marks the button pressed (`admin.css` spins it). A refusal that names its fields (`fields`) shows each problem
 * under its field, marked `aria-invalid` and described by it, and scrolls to and focuses the first; problems that name no field are listed
 * at the foot, scrolled into view. *Saved* (`common.form.saved`, or `successMessage`, or the action's own first message) goes away on the
 * first edit after it, so it never stands beside changes it did not save.
 */
export function ActionForm({
  id,
  action,
  children,
  className,
  successMessage,
  replaceOnSuccess = false,
  successClassName = "rounded-panel border border-line bg-card p-4",
}: {
  id?: string;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  /** What a success says when the action says nothing: *Saved.* in the person's language unless given. */
  successMessage?: string;
  /** Show only the success message once the action succeeds (one-off forms). */
  replaceOnSuccess?: boolean;
  /** The look of that message: the admin's card unless said (Kaizena Flow's own pages have no admin colours, D456). */
  successClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  const formRef = useRef<HTMLFormElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ownId = useId();
  const formKey = id ?? ownId.replace(/[^A-Za-z0-9_-]/g, "");
  const [sent, setSent] = useState<FormData | null>(null);
  const work = useMemo(() => ({ pending, data: pending ? sent : null }), [pending, sent]);
  const listed = useProblemsAtFields(formRef, listRef, state, formKey);
  const { edited, listen } = useEditedSince(state);
  const mark = useSubmitterMark(pending);
  // From the context alone, as `SubmitButton` reads it: a visitor's form brings no catalogue (PERF-11).
  const { saved } = useCommonText().form;
  const said = state.messages[0] ?? successMessage ?? saved;
  if (replaceOnSuccess && state.status === "ok") {
    return (
      <p role="status" className={successClassName}>
        {said}
      </p>
    );
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    mark(submitter);
    setSent(data);
    startTransition(() => formAction(data));
  };
  return (
    <form ref={formRef} id={id} action={formAction} onSubmit={submit} className={className} aria-busy={pending} {...listen}>
      <FormWorkContext.Provider value={work}>{children}</FormWorkContext.Provider>
      <div ref={listRef} role="status" aria-live="polite" className="text-sm">
        {state.status === "ok" && !edited && <p>{said}</p>}
        {listed.length > 0 && (
          <ul className="list-disc pl-5 text-danger-text">
            {listed.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}

export function SubmitButton({
  children,
  disabled,
  variant = "primary",
  name,
  value,
  skipValidation = false,
  className,
}: {
  children: ReactNode;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  /** Set with `value` to tell the action which of several buttons was pressed. */
  name?: string;
  value?: string;
  /** Submit without the browser's field checks (e.g. a Decline button). */
  skipValidation?: boolean;
  /** In place of the variant's look, where the admin's colours are not set (Kaizena Flow's own pages, D456). */
  className?: string;
}) {
  const { pending: posting } = useFormStatus();
  const pending = useContext(FormWorkContext).pending || posting;
  // From the context alone: `useAdminText()` would bring every area's English into a visitor's scripts (PERF-11).
  const { working } = useCommonText().form;
  return (
    <button
      type="submit"
      name={name}
      value={value}
      formNoValidate={skipValidation || undefined}
      disabled={disabled || pending}
      className={className ?? submitClass(variant)}
    >
      {pending ? working : children}
    </button>
  );
}
