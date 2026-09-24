"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * A labelled password input with a Show/Hide button, so a long password can
 * be checked before it is sent.
 */
export function PasswordField({
  label,
  name = "password",
  autoComplete,
  minLength,
  required = true,
  hint,
  aside,
}: {
  label: string;
  name?: string;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  required?: boolean;
  hint?: string;
  /** Shown at the end of the label row, e.g. a "Forgot password?" link. */
  aside?: ReactNode;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {aside}
      </div>
      <div className="flex gap-2">
        <input
          id={id}
          type={shown ? "text" : "password"}
          name={name}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          aria-describedby={hint ? `${id}-hint` : undefined}
          spellCheck={false}
          autoCapitalize="none"
          className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-normal"
        />
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          aria-pressed={shown}
          aria-controls={id}
          className="min-h-10 rounded-md border border-border bg-background px-3"
        >
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
