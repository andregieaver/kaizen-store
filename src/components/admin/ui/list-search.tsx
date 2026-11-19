import { ArrowRight, Search } from "lucide-react";
import { useId, type ReactNode } from "react";

/**
 * The search box over a list (code review step 1.12, D818; FS2, FF6): a GET form with real named inputs, so a search without a script is a
 * navigation and the words stay in the address (a bookmark and the back button work). The bar is the Orders list's: a search icon, the
 * field, the arrow that searches, and room for the list's own tools (`tools`: a Filters fold); `aside` sits beside the bar (*Clear
 * all*) and `children` under it, inside the same form. `keep` carries the list's other values (its view, its order) as hidden inputs.
 * The words are the kit's (`adminText(lang, "kit").search`) or the list's own, the field's label and placeholder the list's. No state:
 * drawn on the server.
 */
export function ListSearch({
  action,
  words,
  name = "q",
  value = "",
  label,
  placeholder,
  maxLength,
  keep = {},
  button = "arrow",
  tools,
  aside,
  children,
  formLabel,
  id: given,
  className,
}: {
  /** The list's address: where the form goes. */
  action: string;
  words: { label: string; button: string };
  name?: string;
  /** What is searched for now. */
  value?: string;
  /** The field's name for a screen reader ("Search orders"); the kit's *Search* otherwise. */
  label?: string;
  placeholder?: string;
  maxLength?: number;
  /** The list's other values, kept as hidden inputs (an empty one is left out). */
  keep?: Record<string, string | null | undefined>;
  /** `arrow`: the round button that searches; `hidden`: Enter searches, the button is read but not seen. */
  button?: "arrow" | "hidden";
  /** In the bar, after the field: the list's Filters. */
  tools?: ReactNode;
  /** Beside the bar, on its line: *Clear all*. */
  aside?: ReactNode;
  /** Under the bar, in the same form. */
  children?: ReactNode;
  /** The form's name as a search landmark. */
  formLabel?: string;
  id?: string;
  className?: string;
}) {
  const made = useId();
  const id = given ?? made;
  const bar = (
    <div className="flex min-w-60 flex-1 items-center gap-2 rounded-pill bg-card py-1 pr-1.5 pl-4 shadow-[inset_0_0_0_1px_var(--color-edge)]">
      <Search aria-hidden className="size-4 shrink-0 text-muted" />
      <label htmlFor={id} className="sr-only">
        {label ?? words.label}
      </label>
      <input
        id={id}
        type="search"
        name={name}
        defaultValue={value}
        maxLength={maxLength}
        placeholder={placeholder}
        className="min-h-9 min-w-0 flex-1 bg-transparent text-body outline-none"
      />
      {button === "arrow" ? (
        <button type="submit" className="flex size-9 shrink-0 items-center justify-center rounded-pill text-ink hover:bg-sunken">
          <ArrowRight aria-hidden className="size-4" />
          <span className="sr-only">{words.button}</span>
        </button>
      ) : (
        <button type="submit" className="sr-only">
          {words.button}
        </button>
      )}
      {tools}
    </div>
  );
  return (
    <form method="get" action={action} role="search" aria-label={formLabel} className={["relative flex flex-col gap-3", className].filter(Boolean).join(" ")}>
      {Object.entries(keep).map(([key, kept]) => (kept ? <input key={key} type="hidden" name={key} value={kept} /> : null))}
      {aside ? (
        <div className="flex flex-wrap items-center gap-2">
          {bar}
          {aside}
        </div>
      ) : (
        bar
      )}
      {children}
    </form>
  );
}
