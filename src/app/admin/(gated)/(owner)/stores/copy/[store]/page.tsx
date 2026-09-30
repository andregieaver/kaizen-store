import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StoreCopyWizard } from "@/components/admin/store-copy-wizard";
import { listStores, requireMember } from "@/server/auth";
import { MAX_STORES_PER_OWNER } from "@/server/platform";

import { copyChoicesAction, startStoreCopyAction } from "../../copy-actions";

export const metadata: Metadata = { title: "Duplicate a store" };

/**
 * Duplicating one of the account's stores (D129): the owner chooses what comes along. Only owners (and the platform's
 * admins) may; anyone else gets a 404 like any store they do not run. The server actions check again.
 */
export default async function DuplicateStorePage({ params }: PageProps<"/admin/stores/copy/[store]">) {
  const { store: slug } = await params;
  const { account, role } = await requireMember(slug);
  if (role !== "owner" && !account.platformAdmin) notFound();

  const owned = (await listStores(account)).filter((store) => store.role === "owner").length;
  const full = !account.platformAdmin && owned >= MAX_STORES_PER_OWNER;
  const result = full ? null : await copyChoicesAction(slug);
  if (result && !result.ok) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted">
          <Link href="/admin/stores" className="underline underline-offset-2">
            Your stores
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Duplicate {result?.ok ? result.choices.source.name : "a store"}</h1>
        <p className="text-sm text-muted">
          Make a new store from this one. Choose what comes along; the new store starts closed and you are its owner.
        </p>
      </div>
      {result?.ok ? (
        <StoreCopyWizard choices={result.choices} start={startStoreCopyAction} />
      ) : (
        <p role="status" className="max-w-xl rounded-lg border border-border bg-background p-5 text-sm">
          You can own up to {MAX_STORES_PER_OWNER} stores. Contact Kaizen for more.
        </p>
      )}
    </div>
  );
}
