import type { ReactNode } from "react";

/**
 * When printing, everything on the page is left out except this area and the elements it sits in, which lose their spacing, borders and
 * backgrounds. It does not depend on where the admin's frame puts `<main>` (beside a sidebar it is inside a wrapper), which is what left the
 * packing slips and the pick list empty when printed. Anything inside the area marked `print:hidden` is still left out.
 */
export const PRINT_AREA_CSS = [
  "@media print {",
  "  body *:not(:has([data-print-area])):not([data-print-area]):not([data-print-area] *) { display: none !important; }",
  "  html, body, body *:has([data-print-area]) { display: block !important; position: static !important; margin: 0 !important; padding: 0 !important;",
  "    gap: 0 !important; max-width: none !important; min-height: 0 !important; border: 0 !important; box-shadow: none !important; background: #fff !important; }",
  "}",
].join("\n");

export function PrintArea({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-print-area className={className}>
      <style>{PRINT_AREA_CSS}</style>
      {children}
    </div>
  );
}
