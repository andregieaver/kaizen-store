"use client";

import Link from "next/link";

import { useAdminText } from "@/components/admin/admin-text";
import { PageHeader } from "@/components/admin/ui";

/**
 * An address in the signed-in admin that leads nowhere, or to something no longer there (`notFound()` in any of its pages), in the
 * account's language (D312): drawn inside the signed-in layout, whose provider holds the `shell` area. The number is the page's title,
 * as Next's own page has it (the signed-in end-to-end tests look for it).
 */
export default function AdminNotFound() {
  const w = useAdminText("shell").notFound;
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-8">
      <PageHeader
        title={"404"}
        description={
          <>
            <p className="text-body-strong text-ink">{w.title}</p>
            <p>{w.text}</p>
          </>
        }
      />
      <p>
        <Link href="/admin" className="text-sm underline">
          {w.home}
        </Link>
      </p>
    </main>
  );
}
