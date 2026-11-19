import type { ReactNode } from "react";

import { fieldClass } from "../ui/field";

/**
 * The small pieces every Work form and panel is drawn with, in the admin's own
 * classes (as the settings form and the deliveries page use them), so the
 * screens look like the rest of the admin and behave the same at phone width.
 * No `"use client"` here: pages read the class names and draw `Badge` on the
 * server, and the forms use the rest in the browser. A labelled field is the
 * admin kit's `Field` (`src/components/admin/ui/field.tsx`, code review 1.12),
 * and the controls' boxes are the kit's.
 */

export const card = "rounded-card bg-card p-5 dark:border dark:border-line forced-colors:border";
export const control = `${fieldClass({ full: true })} disabled:opacity-60`;
export const smallControl = `${fieldClass({ dense: true })} disabled:opacity-60`;
export const primaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-40";
export const secondaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-pill border border-edge bg-card px-4 text-sm disabled:opacity-40";
export const smallButton =
  "inline-flex min-h-9 items-center justify-center rounded-pill border border-edge bg-card px-3 text-sm disabled:opacity-40";
export const dangerLink = "text-sm text-danger-text underline disabled:opacity-50";
export const errorText = "text-sm text-danger-text";
export const hintText = "text-xs font-normal text-muted";

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
  neutral: "bg-sunken text-ink",
  good: "bg-positive-soft text-positive-text",
  warn: "bg-warning-soft text-warning-text",
  bad: "bg-danger-soft text-danger-text",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[tone]}`}>
      {children}
    </span>
  );
}
