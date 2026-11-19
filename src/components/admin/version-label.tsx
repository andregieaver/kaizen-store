/**
 * A version's two lines in a versions list: its kind with *Newest* on the first, then when it was made, by whom and, for a page, its
 * title. One part for the page builder's versions (`PageVersionsDialog`) and a look's (`LookVersionsDialog`), so the two lists read alike.
 */
export function VersionLabel({ kind, newest, when, by, title }: { kind: string; newest: string | null; when: string; by?: string | null; title?: string | null }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="text-sm text-ink">
        {kind}
        {newest && <span className="ml-2 text-xs text-muted">{newest}</span>}
      </span>
      <span className="text-xs text-muted">
        {when}
        {by ? ` · ${by}` : ""}
        {title ? ` · ${title}` : ""}
      </span>
    </div>
  );
}
