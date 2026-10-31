"use client";

/** Puts the AI's draft reason in the decision's reason field (D411 part 2); the person edits it and still presses Decide. */
export function UseDraft({ formId, draft, label }: { formId: string; draft: string; label: string }) {
  return (
    <button
      type="button"
      className="w-fit rounded-pill border border-line px-3 py-1 text-sm hover:bg-sunken"
      onClick={() => {
        const field = document.getElementById(formId)?.querySelector<HTMLTextAreaElement>('textarea[name="decision"]');
        if (!field) return;
        field.value = draft;
        field.focus();
      }}
    >
      {label}
    </button>
  );
}
