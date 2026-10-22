import Link from "next/link";

import { countWords } from "@/lib/admin-fill";
import { notificationsEn, type NotificationsMessages } from "@/lib/admin-messages/notifications.en";
import { failedStoreEvents } from "@/server/staff-alerts";

/**
 * On a store's Home (wave 3, D238, `docs/wave-3-notifications.md` 2.11): *Staff alerts could not be sent* when store events of the last 30 days gave up after
 * their ten tries. Read after the page is shown; a read that fails shows nothing (the page must not break over its own warning).
 */
export async function StaffAlertsFailed({ storeId, href, words }: { storeId: string; href: string; words?: NotificationsMessages }) {
  const failed = await failedStoreEvents(storeId).catch(() => 0);
  return <StaffAlertsFailedNote failed={failed} href={href} words={words} />;
}

/** The note itself, drawn from the count (and tested on its own). */
export function StaffAlertsFailedNote({ failed, href, words = notificationsEn }: { failed: number; href: string; words?: NotificationsMessages }) {
  if (failed <= 0) return null;
  const w = words.staff;
  const [before, after = ""] = w.failedRest.split("{link}");
  return (
    <p role="status" className="rounded-panel border border-warning-line bg-warning-soft p-4 text-body text-warning-text">
      {countWords(failed, w.failed)} {before}
      <Link href={href} className="underline underline-offset-2">
        {w.title}
      </Link>
      {after}
    </p>
  );
}
