import type { ReactNode } from "react";

import { storesOf } from "@/components/admin/admin-shell-parts";
import type { Account } from "@/server/auth";
import { getRunningTimer } from "@/server/work-time";

import { WorkTimerProvider } from "./timer-provider";

/**
 * What every Work page sits in (`(owner)/account/work/layout.tsx`, D123): the
 * person's running timer, one across all their stores, read from the database
 * once, held by the browser from then on, and shown as a bar at the top of the
 * page with the estimate warnings. A layout stays while the person moves
 * between the combined pages and one store's, so the clock and its warnings
 * carry on. The bar names the store when the person has more than one to work
 * in. Every page and action still checks for itself (`requireMember`,
 * `store.workOn`); this only reads the timer, which is the person's own.
 */
export async function WorkShell({ account, children }: { account: Account; children: ReactNode }) {
  const [timer, stores] = await Promise.all([getRunningTimer(account.id), workStoreCount(account)]);
  return (
    <WorkTimerProvider showStore={stores > 1} accountId={account.id} serverTimer={timer}>
      {children}
    </WorkTimerProvider>
  );
}

/** How many of the person's stores have Work on. */
async function workStoreCount(account: Account): Promise<number> {
  return (await storesOf(account)).filter((store) => store.workOn).length;
}
