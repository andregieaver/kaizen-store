import Link from "next/link";

import { WORK_ROOT } from "@/lib/work-paths";

/**
 * What a Work page shows while the module is off (docs/work.md 5.1): the
 * pages stay reachable by address, so they say so and point to the switch,
 * as the subscription boxes page does. Data is kept while it is off.
 */
export function WorkOff({ title }: { storeSlug?: string; title: string }) {
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="rounded-lg border border-border bg-background p-5 text-sm">
        Work is off for this store, so this page is hidden from the menu.{" "}
        <Link href={`${WORK_ROOT}/settings`} className="underline">
          Switch it on in Work settings
        </Link>
        . Everything you saved is kept while it is off.
      </p>
    </div>
  );
}
