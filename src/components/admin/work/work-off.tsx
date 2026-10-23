import Link from "next/link";

import { WORK_ROOT } from "@/lib/work-paths";
import { PageHeader } from "@/components/admin/ui";
import { workEn, type WorkMessages } from "@/lib/admin-messages/work.en";

/**
 * What a Work page shows while the module is off (docs/work.md 5.1): the
 * pages stay reachable by address, so they say so and point to the switch,
 * as the subscription boxes page does. Data is kept while it is off.
 */
export function WorkOff({ title, words = workEn.off }: { storeSlug?: string; title: string; words?: WorkMessages["off"] }) {
  return (
    <PageHeader
      title={<>{title}</>}
      description={<>{words.isOff}{" "}<Link href={`${WORK_ROOT}/settings`} className="underline">{words.switchOn}</Link>. {words.kept}</>}
    />
  );
}
