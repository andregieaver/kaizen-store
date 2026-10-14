import Link from "next/link";
import { workBase } from "@/lib/work-paths";
import { PageHeader } from "@/components/admin/ui";

/**
 * A stand-in for a Work page that is built in a later step, so the menu's
 * links never lead nowhere. The real page replaces the route's page file.
 */
export function WorkComingSoon({ storeSlug, title }: { storeSlug: string; title: string }) {
  return (
    <PageHeader
      title={<>{title}</>}
      description={<>Coming in the next step.{" "}<Link href={workBase(storeSlug)} className="underline">Back to Work</Link></>}
    />
  );
}
