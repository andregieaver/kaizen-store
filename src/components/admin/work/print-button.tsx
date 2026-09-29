"use client";

import { useEffect } from "react";

/**
 * Opens the browser's print dialog. The browser names a saved PDF after the
 * page's title, so while the dialog is open the title is the document's
 * ("Invoice W-1001"), and it is put back afterwards.
 */
function printDocument(documentTitle: string) {
  try {
    const previous = document.title;
    if (documentTitle) {
      document.title = documentTitle;
      window.addEventListener(
        "afterprint",
        () => {
          document.title = previous;
        },
        { once: true },
      );
    }
    window.print();
  } catch {
    // A browser that cannot print from a script: the button is still there.
  }
}

/**
 * "Print or save as PDF" for a Work document; hidden when printing. With
 * `auto` (`?auto=1` on the page) it opens the dialog once the document has
 * been drawn, and takes `?auto=1` off the address so a reload does not print
 * again.
 */
export function PrintButton({
  label,
  documentTitle,
  auto = false,
}: {
  label: string;
  documentTitle: string;
  auto?: boolean;
}) {
  useEffect(() => {
    if (!auto) return;
    const timer = window.setTimeout(() => {
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has("auto")) {
          url.searchParams.delete("auto");
          window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
        }
      } catch {
        // The address stays as it is.
      }
      printDocument(documentTitle);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [auto, documentTitle]);

  return (
    <button
      type="button"
      onClick={() => printDocument(documentTitle)}
      className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background print:hidden"
    >
      {label}
    </button>
  );
}
