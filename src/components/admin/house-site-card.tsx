import Link from "next/link";
import type { ComponentProps } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import type { AdminLang } from "@/lib/admin-lang";
import { countWords } from "@/lib/admin-fill";
import { HOUSE_STORE_SLUG } from "@/lib/platform-nav";
import { CONSOLE_WORDS } from "@/lib/admin-words/console";
import type { SiteCopy } from "@/server/house-site";

type CopyAction = ComponentProps<typeof ActionForm>["action"];

/**
 * Kaizena Flow's site copied into its own store (D469, step 3 of `docs/platform-parity-plan.md`), on Platform → Website: when it was last
 * copied, a link to look at the copy in the store, and the one button that copies it again. The live site never changes from here.
 */
export function HouseSiteCard({ lang, last, copy }: { lang: AdminLang; last: SiteCopy; copy: CopyAction }) {
  const w = CONSOLE_WORDS[lang].houseSite;
  const when = last.copiedAt ? adminDate(PLATFORM_TIME_ZONE, last.copiedAt, "dayTime", lang) : null;
  return (
    <Card title={w.title} description={w.description}>
      <ActionForm action={copy} className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          {when ? countWords(last.rows, w.last, { when }) : w.never}{" "}
          {when && (
            <Link href={`/admin/${HOUSE_STORE_SLUG}/pages`} className="underline">
              {w.look}
            </Link>
          )}
        </p>
        <div>
          <SubmitButton>{when ? w.again : w.first}</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
