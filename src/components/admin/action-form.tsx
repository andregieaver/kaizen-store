"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  type FormEvent,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";

import { useAdminText } from "./admin-text";

export type FormState = { status: "idle" | "ok" | "error"; messages: string[] };

export const idle: FormState = { status: "idle", messages: [] };

const PendingContext = createContext(false);

/**
 * A form bound to a server action, showing its outcome in a live region.
 *
 * With JavaScript, the action is called from a transition rather than by the
 * form itself, so React does not clear the fields afterwards: a form that
 * fails validation keeps what was typed. Without JavaScript it still posts.
 */
export function ActionForm({
  id,
  action,
  children,
  className,
  successMessage = "Saved.",
  replaceOnSuccess = false,
}: {
  id?: string;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  successMessage?: string;
  /** Show only the success message once the action succeeds (one-off forms). */
  replaceOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  if (replaceOnSuccess && state.status === "ok") {
    return (
      <p role="status" className="rounded-panel border border-line bg-card p-4">
        {state.messages[0] ?? successMessage}
      </p>
    );
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(data));
  };
  return (
    <form id={id} action={formAction} onSubmit={submit} className={className} aria-busy={pending}>
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      <div role="status" aria-live="polite" className="text-sm">
        {state.status === "ok" && <p>{state.messages[0] ?? successMessage}</p>}
        {state.status === "error" && (
          <ul className="list-disc pl-5 text-danger-text">
            {state.messages.map((message) => (
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
}: {
  children: ReactNode;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  /** Set with `value` to tell the action which of several buttons was pressed. */
  name?: string;
  value?: string;
  /** Submit without the browser's field checks (e.g. a Decline button). */
  skipValidation?: boolean;
}) {
  const { pending: posting } = useFormStatus();
  const pending = useContext(PendingContext) || posting;
  const { working } = useAdminText("common").form;
  return (
    <button
      type="submit"
      name={name}
      value={value}
      formNoValidate={skipValidation || undefined}
      disabled={disabled || pending}
      className={
        variant === "primary"
          ? "min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-40"
          : "min-h-10 rounded-pill border border-edge bg-card px-4 text-sm disabled:opacity-40"
      }
    >
      {pending ? working : children}
    </button>
  );
}
