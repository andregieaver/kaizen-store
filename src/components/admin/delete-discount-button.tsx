"use client";

import { useState, useTransition } from "react";

/** Deletes a code, after asking; orders that used it keep what they got. */
export function DeleteDiscountButton({
  action,
  code,
  used = 0,
  compact = false,
  question: asked,
}: {
  action: () => Promise<{ ok: true } | { ok: false; problems: string[] }>;
  code: string;
  /** Orders that used it: they keep their discount, which the question says. */
  used?: number;
  /** A small button for a table row. */
  compact?: boolean;
  /** Asks this instead of the store's question. */
  question?: string;
}) {
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className={compact ? "inline-flex flex-col items-end" : "flex flex-col gap-1 border-t border-border pt-4"}>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const question =
            asked ??
            (used > 0
              ? `Delete the code ${code}? Shoppers can no longer use it. The ${used} ${used === 1 ? "order" : "orders"} that used it keep their discount.`
              : `Delete the code ${code}? Shoppers can no longer use it.`);
          if (!window.confirm(question)) return;
          start(async () => {
            const result = await action();
            if (!result.ok) setProblem(result.problems.join(" "));
          });
        }}
        className={
          compact
            ? "min-h-10 rounded-md px-3 text-sm text-red-700 hover:bg-surface disabled:opacity-50"
            : "w-fit text-sm text-red-700 underline disabled:opacity-50"
        }
      >
        {pending ? "Deleting …" : compact ? (
          <>
            Delete<span className="sr-only"> {code}</span>
          </>
        ) : (
          "Delete this code"
        )}
      </button>
      {problem && (
        <p role="alert" className="text-sm">
          {problem}
        </p>
      )}
    </div>
  );
}
