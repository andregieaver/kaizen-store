import Link from "next/link";
import type { ComponentProps } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { HOUSE_STORE_SLUG } from "@/lib/platform-nav";
import type { SiteCopy } from "@/server/house-site";

type CopyAction = ComponentProps<typeof ActionForm>["action"];

/**
 * Kaizena Flow's site copied into its own store (D469, step 3 of `docs/platform-parity-plan.md`), on Platform → Website: when it was last
 * copied, a link to look at the copy in the store, and the one button that copies it again. The live site never changes from here.
 */
export function HouseSiteCard({ lang, last, copy }: { lang: AdminLang; last: SiteCopy; copy: CopyAction }) {
  const w = adminText(lang, "platform").houseSite;
  const when = last.copiedAt
    ? new Date(last.copiedAt).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" })
    : null;
  return (
    <Card title={w.title} description={w.description}>
      <ActionForm action={copy} className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          {when ? fillWords(w.last, { when, rows: String(last.rows) }) : w.never}{" "}
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
