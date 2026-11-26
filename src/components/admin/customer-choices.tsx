"use client";

/** A customer found by a picker's search: their name and email only. */
export type CustomerChoiceView = { id: string; name: string; email: string };

/**
 * The customers a picker's search found (a draft order's customer, a task's in Projects): each a button with their name and email, or a line
 * saying none was found.
 */
export function CustomerChoiceList({ choices, label, none, onChoose }: { choices: CustomerChoiceView[]; label: string; none: string; onChoose: (choice: CustomerChoiceView) => void }) {
  return (
    <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-sunken text-sm" aria-label={label}>
      {choices.length === 0 && <li className="p-2 text-muted">{none}</li>}
      {choices.map((c) => (
        <li key={c.id}>
          <button type="button" onClick={() => onChoose(c)} className="flex w-full flex-col items-start p-2 text-left hover:bg-card">
            <span>{c.name || c.email}</span>
            {c.name && <span className="text-xs text-muted">{c.email}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
