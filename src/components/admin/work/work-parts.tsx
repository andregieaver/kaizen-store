import { useId, type ReactNode } from "react";

/**
 * The small pieces every Work form and panel is drawn with, in the admin's own
 * classes (as the settings form and the deliveries page use them), so the
 * screens look like the rest of the admin and behave the same at phone width.
 * No `"use client"` here: pages read the class names and draw `Badge` on the
 * server, and the forms use the rest in the browser. `Field` takes a function
 * for its control, so only client components draw it.
 */

export const card = "rounded-lg border border-border bg-background p-5";
export const control =
  "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal disabled:opacity-60";
export const smallControl =
  "min-h-9 rounded-md border border-border bg-background px-2 text-sm font-normal disabled:opacity-60";
export const primaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40";
export const secondaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm disabled:opacity-40";
export const smallButton =
  "inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm disabled:opacity-40";
export const dangerLink = "text-sm text-red-700 underline disabled:opacity-50 dark:text-red-400";
export const errorText = "text-sm text-red-700 dark:text-red-400";
export const hintText = "text-xs font-normal text-muted";

/** What a control needs to be tied to its label, its hint and its message. */
export type FieldProps = { id: string; "aria-invalid"?: true; "aria-describedby"?: string };

/**
 * A labelled field with an optional hint and an inline message. The control
 * is drawn by `children` with the props it must carry, so the label is really
 * its label, and a message is read with it (`aria-describedby`, `aria-invalid`).
 */
export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (props: FieldProps) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        ...(error ? { "aria-invalid": true as const } : {}),
        ...(described ? { "aria-describedby": described } : {}),
      })}
      {hint && (
        <p id={`${id}-hint`} className={hintText}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={errorText}>
          {error}
        </p>
      )}
    </div>
  );
}

/** What went wrong, read out when it appears. Nothing is drawn when there is nothing. */
export function Problems({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div role="alert" className={errorText}>
      {messages.length === 1 ? (
        <p>{messages[0]}</p>
      ) : (
        <ul className="list-disc pl-5">
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const BADGE = {
  neutral: "bg-surface text-foreground",
  good: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  bad: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[tone]}`}>
      {children}
    </span>
  );
}
