"use client";

import { useEffect } from "react";

/**
 * Shown when an admin page fails to load, instead of a page that never
 * finishes. Retrying renders the page again.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">This page could not be loaded</h1>
      <p className="text-sm text-muted">
        Something went wrong on our side. Nothing you entered was lost. Try again, and if it keeps
        happening, tell Kaizen{error.digest ? ` (reference ${error.digest})` : ""}.
      </p>
      <div>
        <button
          type="button"
          onClick={reset}
          className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
