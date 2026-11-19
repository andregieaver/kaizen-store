"use client";

import { countWords, fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";
import { ConfirmButton } from "./ui/confirm-button";

/** Deletes a code, after asking in the admin's dialog (`ConfirmButton`, code review 1.12); orders that used it keep what they got. */
export function DeleteDiscountButton({
  action,
  code,
  used = 0,
  compact = false,
  question: asked,
  label,
}: {
  action: () => Promise<{ ok: true } | { ok: false; problems: string[] }>;
  code: string;
  /** Orders that used it: they keep their discount, which the question says. */
  used?: number;
  /** A small button for a table row. */
  compact?: boolean;
  /** Asks this instead of the store's question. */
  question?: string;
  /** The full-size button's words; "Delete this code" in the admin's language unless given. */
  label?: string;
}) {
  const w = useAdminText("discounts").remove;
  const form = useAdminText("common").form;
  const question = asked ?? (used > 0 ? countWords(used, w.questionUsed, { code }) : fillWords(w.question, { code }));
  return (
    <div className={compact ? "inline-flex flex-col items-end" : "flex flex-col gap-1 border-t border-line pt-4"}>
      <ConfirmButton
        kind="none"
        question={question}
        confirm={form.delete}
        action={action}
        busy={form.deleting}
        className={
          compact
            ? "min-h-10 rounded-md px-3 text-sm text-danger-text hover:bg-sunken disabled:opacity-50"
            : "w-fit text-sm text-danger-text underline disabled:opacity-50"
        }
      >
        {compact ? (
          <>
            {form.delete}
            <span className="sr-only"> {code}</span>
          </>
        ) : (
          (label ?? w.deleteCode)
        )}
      </ConfirmButton>
    </div>
  );
}
