"use client";

/** Opens the browser's print dialog. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink print:hidden"
    >
      {label}
    </button>
  );
}
