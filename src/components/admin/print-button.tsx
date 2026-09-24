"use client";

/** Opens the browser's print dialog. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background print:hidden"
    >
      {label}
    </button>
  );
}
