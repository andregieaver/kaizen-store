"use client";

import { useEffect } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

/**
 * Shown when an admin page fails to load, instead of a page that never
 * finishes. Retrying renders the page again.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const w = useAdminText("shell").error;
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-8">
      <h1 className="text-display text-ink">{w.title}</h1>
      <p className="text-sm text-muted">{fillWords(w.body, { reference: error.digest ? fillWords(w.reference, { digest: error.digest }) : "" })}</p>
      <div>
        <button
          type="button"
          onClick={reset}
          className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink"
        >
          {w.retry}
        </button>
      </div>
    </main>
  );
}
