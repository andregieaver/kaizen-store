"use client";

import { useState } from "react";

/**
 * Copies a link to the clipboard, and says so (in place, for screen readers too). Where the browser will not let a page
 * write to the clipboard, the link is selected in its field instead, so it can be copied by hand.
 */
export function CopyLinkButton({
  link,
  labels,
  inputId,
}: {
  link: string;
  labels: { copy: string; copied: string };
  /** The id of the read-only field that shows the link, selected when copying is not possible. */
  inputId: string;
}) {
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setDone(true);
      window.setTimeout(() => setDone(false), 3000);
    } catch {
      const field = document.getElementById(inputId) as HTMLInputElement | null;
      field?.focus();
      field?.select();
    }
  }

  return (
    <>
      <button type="button" onClick={copy} className="min-h-11 button-primary px-4 text-sm font-medium">
        {labels.copy}
      </button>
      <span role="status" aria-live="polite" className="text-sm">
        {done ? labels.copied : ""}
      </span>
    </>
  );
}
