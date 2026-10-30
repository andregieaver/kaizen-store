"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";

import { problemId } from "@/lib/form-problems";

import { useCommonText } from "./admin-text-context";

/** `fields` ties a problem to the field it is about, by the field's name (`formProblems()`, PSI ACC-05). */
export type FormState = { status: "idle" | "ok" | "error"; messages: string[]; fields?: Record<string, string> };

export const idle: FormState = { status: "idle", messages: [] };

const PendingContext = createContext(false);

/**
 * A form bound to a server action, showing its outcome in a live region.
 *
 * With JavaScript, the action is called from a transition rather than by the
 * form itself, so React does not clear the fields afterwards: a form that
 * fails validation keeps what was typed. Without JavaScript it still posts.
 * A refusal that names its fields (`fields`) marks each one `aria-invalid`,
 * describes it by its message in the list and moves the focus to the first.
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
  const formRef = useRef<HTMLFormElement>(null);
  const ownId = useId();
  const formKey = id ?? ownId.replace(/[^A-Za-z0-9_-]/g, "");
  const fields = state.status === "error" ? (state.fields ?? {}) : {};
  const fieldOf = (message: string) => Object.entries(fields).find(([, text]) => text === message)?.[0];
  // The fields the last refusal named: marked, described by their message, the first focused; marks from before are taken away.
  const marked = useRef<Element[]>([]);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    for (const element of marked.current) {
      element.removeAttribute("aria-invalid");
      element.removeAttribute("aria-describedby");
    }
    const now: Element[] = [];
    const named = state.status === "error" ? (state.fields ?? {}) : {};
    for (const [name, message] of Object.entries(named)) {
      // Fields with the same message share its one line in the list: the first field's name gives it its id.
      const owner = Object.entries(named).find(([, text]) => text === message)?.[0] ?? name;
      for (const element of form.querySelectorAll(`[name="${CSS.escape(name)}"]`)) {
        if (element.getAttribute("type") === "hidden") continue;
        element.setAttribute("aria-invalid", "true");
        element.setAttribute("aria-describedby", problemId(formKey, owner));
        now.push(element);
      }
    }
    marked.current = now;
    (now[0] as HTMLElement | undefined)?.focus();
  }, [state, formKey]);
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
    <form ref={formRef} id={id} action={formAction} onSubmit={submit} className={className} aria-busy={pending}>
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      <div role="status" aria-live="polite" className="text-sm">
        {state.status === "ok" && <p>{state.messages[0] ?? successMessage}</p>}
        {state.status === "error" && (
          <ul className="list-disc pl-5 text-danger-text">
            {state.messages.map((message) => {
              const field = fieldOf(message);
              return (
                <li key={message} id={field ? problemId(formKey, field) : undefined}>
                  {message}
                </li>
              );
            })}
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
  // From the context alone: `useAdminText()` would bring every area's English into a visitor's scripts (PERF-11).
  const { working } = useCommonText().form;
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
