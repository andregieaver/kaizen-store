"use client";

import { useState } from "react";

import { browserText } from "@/lib/browser-text";

import { forgetRecordings } from "../signals/forget";

/**
 * The Cookies page's *Delete my recordings* (D656, `docs/heatmaps-and-recordings.md` 8.3): deletes the recordings of visits this browser
 * made on the shop, whether or not it still allows them, and says so. Works on the ids the browser kept; the server never learns who asked.
 */
export function DeleteRecordings({ store, lang }: { store: { id: string; slug: string }; lang: string }) {
  const m = browserText(lang).recordings;
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="w-fit min-h-11 rounded-md border border-border px-4 text-sm font-medium"
        onClick={() => {
          forgetRecordings(store);
          setDone(true);
        }}
      >
        {m.delete}
      </button>
      <p role="status" className="text-sm text-muted">
        {done ? m.deleted : ""}
      </p>
    </div>
  );
}
