"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export type FormState = { status: "idle" | "ok" | "error"; messages: string[] };

export const idle: FormState = { status: "idle", messages: [] };

/** A form bound to a server action, showing its outcome in a live region. */
export function ActionForm({
  action,
  children,
  className,
  successMessage = "Saved.",
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  successMessage?: string;
}) {
  const [state, formAction] = useActionState(action, idle);
  return (
    <form action={formAction} className={className}>
      {children}
      <div role="status" aria-live="polite" className="text-sm">
        {state.status === "ok" && <p>{state.messages[0] ?? successMessage}</p>}
        {state.status === "error" && (
          <ul className="list-disc pl-5 text-red-700 dark:text-red-400">
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
}: {
  children: ReactNode;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={
        variant === "primary"
          ? "min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
          : "min-h-10 rounded-md border border-border bg-background px-4 text-sm disabled:opacity-40"
      }
    >
      {pending ? "Working …" : children}
    </button>
  );
}
