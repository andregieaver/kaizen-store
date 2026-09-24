"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { forgetAdminPages, rememberAdminPage } from "@/lib/admin-return";

/** Remembers the store admin page being viewed, for the storefront's "Back to admin". */
export function AdminTrail({ storeSlug }: { storeSlug: string }) {
  const pathname = usePathname();
  useEffect(() => {
    rememberAdminPage(storeSlug, `${pathname}${window.location.search}`);
  }, [storeSlug, pathname]);
  return null;
}

/** The sign-out form; it also forgets the admin pages, so the storefront stops offering a way back. */
export function SignOutForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={forgetAdminPages}>
      <button type="submit" className="underline">
        Sign out
      </button>
    </form>
  );
}
