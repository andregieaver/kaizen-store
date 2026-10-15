import Link from "next/link";

import { failedStoreEvents } from "@/server/staff-alerts";

/**
 * On a store's Home (wave 3, D238, `docs/wave-3-notifications.md` 2.11): *Staff alerts could not be sent* when store events of the last 30 days gave up after
 * their ten tries. Read after the page is shown; a read that fails shows nothing (the page must not break over its own warning).
 */
export async function StaffAlertsFailed({ storeId, href }: { storeId: string; href: string }) {
  const failed = await failedStoreEvents(storeId).catch(() => 0);
  return <StaffAlertsFailedNote failed={failed} href={href} />;
}

/** The note itself, drawn from the count (and tested on its own). */
export function StaffAlertsFailedNote({ failed, href }: { failed: number; href: string }) {
  if (failed <= 0) return null;
  return (
    <p role="status" className="rounded-panel border border-warning-line bg-warning-soft p-4 text-body text-warning-text">
      Staff alerts could not be sent: {failed} {failed === 1 ? "order or return" : "orders or returns"} of the last 30 days did not reach the team after ten tries.
      The orders themselves are fine. Check the recipients under{" "}
      <Link href={href} className="underline underline-offset-2">
        Staff alerts
      </Link>{" "}
      and the email log.
    </p>
  );
}
