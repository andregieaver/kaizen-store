"use client";

import { startTransition, useId, useMemo, useRef, useState, useTransition, type FormEvent, type FormHTMLAttributes, type ReactNode } from "react";
import { requestFormReset } from "react-dom";

import { answerOf, type FormAnswer } from "@/lib/form-problems";

import { useProblemsAtFields, useSubmitterMark } from "./form-answer";
import { FormWorkContext } from "./form-work";

type FormProps = Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "children" | "onSubmit" | "method" | "encType">;

const NOTHING_YET: FormAnswer = { status: "idle", messages: [] };

/**
 * A form whose action answers by what it does (code review step 1.15, D829): it removes, moves, switches or connects, then refreshes the page
 * or goes elsewhere, so it says nothing when it worked. Every admin form bound to a server action that is not an `ActionForm` is this one:
 * a server page hands it a bound server action (`action={removeAction.bind(null, store.slug, id)}`) that returns nothing or a refusal
 * (`FormState`, or `{ ok: false, problems }`), and its children are drawn by the page.
 *
 * While it works the form is `aria-busy`, takes no second submission and marks the button pressed (`admin.css` spins it and lets no
 * button of the form be pressed; `SubmitButton` and `ConfirmButton` read the same work from `FormWorkContext`). A refusal is shown: its
 * problems that name a field under that field, the rest after the form's buttons. What was typed is kept after a refusal and cleared after a
 * success, as React clears a form whose action it runs. Without JavaScript it posts as a plain form does. `onSubmit` runs first, and a
 * submission it prevents is not sent.
 */
export function QuietActionForm({
  action,
  onSubmit,
  id,
  children,
  ...rest
}: FormProps & {
  action: (formData: FormData) => unknown;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  const [answer, setAnswer] = useState<FormAnswer>(NOTHING_YET);
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<FormData | null>(null);
  const work = useMemo(() => ({ pending, data: pending ? sent : null }), [pending, sent]);
  const formRef = useRef<HTMLFormElement>(null);
  const listRef = useRef<HTMLSpanElement>(null);
  const ownId = useId();
  const formKey = id ?? ownId.replace(/[^A-Za-z0-9_-]/g, "");
  const listed = useProblemsAtFields(formRef, listRef, answer, formKey);
  const mark = useSubmitterMark(pending);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    onSubmit?.(event);
    if (event.defaultPrevented) return;
    // Called from this transition, not by the form: the answer is kept, and a refusal keeps what was typed.
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(form, submitter);
    mark(submitter);
    setSent(data);
    // A redirect rejects the call and is the router's to follow, as with a form's own action: nothing here catches it.
    start(async () => {
      const said = answerOf(await action(data));
      startTransition(() => {
        setAnswer(said);
        // A form the refreshed page no longer draws (its row removed) has nothing left to clear.
        if (said.status !== "error" && form.isConnected) requestFormReset(form);
      });
    });
  };
  return (
    <form ref={formRef} id={id} action={action as (formData: FormData) => Promise<void>} onSubmit={submit} aria-busy={pending} {...rest}>
      <FormWorkContext.Provider value={work}>{children}</FormWorkContext.Provider>
      {listed.length > 0 && (
        <span ref={listRef} role="alert" className="text-sm text-danger-text">
          {listed.join(" ")}
        </span>
      )}
    </form>
  );
}
