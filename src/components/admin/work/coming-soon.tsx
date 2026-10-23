import Link from "next/link";
import { workBase } from "@/lib/work-paths";
import { PageHeader } from "@/components/admin/ui";
import { workEn, type WorkMessages } from "@/lib/admin-messages/work.en";

/**
 * A stand-in for a Work page that is built in a later step, so the menu's
 * links never lead nowhere. The real page replaces the route's page file.
 */
export function WorkComingSoon({ storeSlug, title, words = workEn.off }: { storeSlug: string; title: string; words?: WorkMessages["off"] }) {
  return (
    <PageHeader
      title={<>{title}</>}
      description={<>{words.comingSoon}{" "}<Link href={workBase(storeSlug)} className="underline">{words.backToWork}</Link></>}
    />
  );
}
