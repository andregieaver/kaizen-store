"use client";

import Link from "next/link";

import { useAdminText } from "@/components/admin/admin-text";

/**
 * An address in the signed-in admin that leads nowhere, or to something no longer there (`notFound()` in any of its pages), in the
 * account's language (D312): drawn inside the signed-in layout, whose provider holds the `shell` area. The number is the page's title,
 * as Next's own page has it (the signed-in end-to-end tests look for it).
 *
 * Its title is its own, in the page header's look, as the error boundary's is (D873): this boundary is in every admin screen's first
 * scripts in a chunk of its own, and importing `PageHeader` put a second copy of the header, its icon and its section's eyebrow in each
 * (3.3 KB), beside the copy the pages' headers bring.
 */
export default function AdminNotFound() {
  const w = useAdminText("shell").notFound;
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-8">
      <header>
        <h1 className="text-display text-ink">404</h1>
        <div className="mt-2 max-w-[75ch] text-body text-ink-2">
          <p className="text-body-strong text-ink">{w.title}</p>
          <p>{w.text}</p>
        </div>
      </header>
      <p>
        <Link href="/admin" className="text-sm underline">
          {w.home}
        </Link>
      </p>
    </main>
  );
}
