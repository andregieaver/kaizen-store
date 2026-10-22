"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useAdminText } from "@/components/admin/admin-text";

/**
 * The *Notify the customer* box while the email is switched off in Notifications (wave 3, D238, `docs/wave-3-notifications.md` 2.2): unticked, disabled
 * and saying so, with a link to the switch. The server ignores a `notify` sent anyway (the sender asks `notificationOn()`).
 */
export function NotifySwitchedOff({ href, children }: { href: string; children: ReactNode }) {
  const w = useAdminText("order").notifyOff;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
      <input type="checkbox" disabled checked={false} readOnly className="size-4" aria-label={w.label} />
      <span>{children}:</span>
      <span>
        {w.switchedOff}{" "}
        <Link href={href} className="underline underline-offset-2">
          {w.notifications}
        </Link>
      </span>
    </p>
  );
}
