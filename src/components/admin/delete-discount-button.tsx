"use client";

import { useState, useTransition } from "react";

/** Deletes an unused code, after asking. */
export function DeleteDiscountButton({
  action,
  code,
}: {
  action: () => Promise<{ ok: true } | { ok: false; problems: string[] }>;
  code: string;
}) {
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Delete the code ${code}? Shoppers can no longer use it.`)) return;
          start(async () => {
            const result = await action();
            if (!result.ok) setProblem(result.problems.join(" "));
          });
        }}
        className="w-fit text-sm text-red-700 underline disabled:opacity-50"
      >
        {pending ? "Deleting …" : "Delete this code"}
      </button>
      {problem && (
        <p role="alert" className="text-sm">
          {problem}
        </p>
      )}
    </div>
  );
}
