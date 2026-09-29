import type { ReactNode } from "react";

import type { Membership } from "@/server/auth";
import { getRunningTimer } from "@/server/work-time";

import { WorkTimerProvider } from "./timer-provider";

/**
 * What every Work page sits in (`work/layout.tsx`): the person's running
 * timer, read from the database once, held by the browser from then on, and
 * shown as a bar at the top of the page with the estimate warnings. A layout
 * stays while the person moves between Work pages, so the clock and its
 * warnings carry on. Passes the page through when Work is off; each page
 * still checks for itself (`requireMember`, `store.workOn`).
 */
export async function WorkShell({ member, children }: { member: Membership; children: ReactNode }) {
  const { store, account } = member;
  if (!store.workOn) return <>{children}</>;
  const timer = await getRunningTimer(store.id, account.id);
  return (
    <WorkTimerProvider storeSlug={store.slug} accountId={account.id} serverTimer={timer}>
      {children}
    </WorkTimerProvider>
  );
}
