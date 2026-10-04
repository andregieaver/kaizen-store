"use client";

import { useEffect } from "react";

/**
 * Opens the browser's print dialog for a hosted invoice or credit note (D159). The browser names a saved PDF after the page's title, so while
 * the dialog is open the title is the document's ("Invoice F-17") and is put back afterwards. With `auto` (the PDF route's fallback address,
 * `?print=1`, when Chromium could not make the file) it opens the dialog once the document has been drawn and takes `?print=1` off the
 * address, so a reload does not print again. No cookie, no storage.
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

export function DocumentPrintButton({ label, documentTitle, auto = false }: { label: string; documentTitle: string; auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const timer = window.setTimeout(() => {
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has("print")) {
          url.searchParams.delete("print");
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
    <button type="button" onClick={() => printDocument(documentTitle)} className="min-h-11 rounded-button border border-border px-5 text-sm font-medium print:hidden">
      {label}
    </button>
  );
}
