import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StoreCopyWizard } from "@/components/admin/store-copy-wizard";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { listStores } from "@/server/auth";
import { memberCan, requireMemberAny } from "@/server/permissions";
import { MAX_STORES_PER_OWNER } from "@/server/platform";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { copyChoicesAction, startStoreCopyAction } from "../../copy-actions";
import { fillWords } from "@/lib/admin-fill";

export const metadata: Metadata = { title: "Duplicate a store" };

/**
 * Duplicating one of the account's stores (D129): the owner chooses what comes along. Only owners (and the platform's
 * admins) may; anyone else gets a 404 like any store they do not run. The server actions check again.
 */
export default async function DuplicateStorePage({
  params,
}: PageProps<"/admin/stores/copy/[store]">) {
  const { store: slug } = await params;
  const member = await requireMemberAny(slug);
  const { account } = member;
  if (!memberCan(member, "owner") && !account.platformAdmin) notFound();

  const owned = (await listStores(account)).filter(
    (store) => store.role === "owner",
  ).length;
  const full = !account.platformAdmin && owned >= MAX_STORES_PER_OWNER;
  const result = full ? null : await copyChoicesAction(slug);
  if (result && !result.ok) notFound();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").copyPage;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted">
          <Link href="/admin/stores" className="underline underline-offset-2">
            {w.back}
          </Link>
        </p>
        <PageHeader
          title={result?.ok ? fillWords(w.title, { name: result.choices.source.name }) : w.titleAny}
          description={w.description}
        />
      </div>
      {result?.ok ? (
        <AdminTextScope
          texts={adminTexts(lang, ["platform"])}
        >
          <StoreCopyWizard
            choices={result.choices}
            start={startStoreCopyAction}
          />
        </AdminTextScope>
      ) : (
        <p role="status" className={`max-w-xl p-5 text-sm ${CARD_CLASS}`}>
          {fillWords(w.limit, { max: MAX_STORES_PER_OWNER })}
        </p>
      )}
    </div>
  );
}
