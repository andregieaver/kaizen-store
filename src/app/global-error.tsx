"use client";

import "./globals.css";

/**
 * Shown when a root layout itself fails (PSI 2026-10-24, REL-01): it replaces the whole document, so it carries its own `<html>` and
 * `<body>`, knows neither the site nor its language, and says so plainly in the four hand-written languages, as `global-not-found.tsx`
 * does. A store page's own failures are caught lower down, in the shopper's language, by `s/[store]/[market]/error.tsx`.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center font-sans">
        <title>Something went wrong</title>
        <h1 className="text-2xl">Something went wrong</h1>
        <p>
          This page could not be shown. · <span lang="nb">Siden kunne ikke vises.</span> ·{" "}
          <span lang="sv">Sidan kunde inte visas.</span> · <span lang="da">Siden kunne ikke vises.</span>
        </p>
        <button type="button" onClick={retry} className="min-h-11 rounded-full border px-5">
          Try again · <span lang="nb">Prøv igjen</span>
        </button>
        {digest ? <p className="text-sm opacity-70">Reference: {digest}</p> : null}
      </body>
    </html>
  );
}
