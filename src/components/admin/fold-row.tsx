/**
 * One setting as a row with its words; Change (or Add, Choose) opens its form in place (rounds 10 and 15, D633, D647). Without an action the
 * row only tells. `open` starts it open, for a row the owner has just come back to or that a form's answer belongs to.
 */
export function FoldRow({
  title,
  sub,
  action,
  open,
  children,
}: {
  title: string;
  sub: React.ReactNode;
  action: string | null;
  open?: boolean;
  children?: React.ReactNode;
}) {
  const head = (
    <span className="flex min-w-0 flex-col">
      <span className="text-body text-ink">{title}</span>
      <span className="text-caption text-ink-2">{sub}</span>
    </span>
  );
  if (!action) return <li className="flex min-h-14 items-center py-3">{head}</li>;
  return (
    <li>
      <details className="group" open={open}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-3 [&::-webkit-details-marker]:hidden">
          {head}
          <span className="shrink-0 text-sm font-medium text-ink underline underline-offset-2">
            {action}
            <span className="sr-only"> {title}</span>
          </span>
        </summary>
        <div className="pb-5">{children}</div>
      </details>
    </li>
  );
}
