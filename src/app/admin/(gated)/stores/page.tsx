import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { StoresList } from "@/components/admin/stores-list";
import { listStores, requireAccount } from "@/server/auth";
import { MAX_STORES_PER_OWNER } from "@/server/platform";

import { createStoreAction } from "./actions";

export const metadata: Metadata = { title: "Your stores" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/** All the account's stores, and a way to create another. */
export default async function AllStoresPage() {
  const account = await requireAccount();
  const stores = await listStores(account);
  const owned = stores.filter((store) => store.role === "owner").length;
  const canCreate = account.platformAdmin || (owned > 0 && owned < MAX_STORES_PER_OWNER);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Your stores</h1>
        <p className="text-sm text-muted">Each store has its own products, Stripe account and plan.</p>
      </div>
      <StoresList stores={stores} />

      {canCreate && (
        <section aria-labelledby="new-store" className="flex max-w-xl flex-col gap-3 rounded-lg border border-border bg-background p-5">
          <div>
            <h2 id="new-store" className="font-medium">
              Create a store
            </h2>
            <p className="text-sm text-muted">
              It starts as a copy of the demo store, with you as owner. You then add your business
              details, set up payments and choose its plan.
            </p>
          </div>
          <ActionForm action={createStoreAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Store name
              <input name="name" required maxLength={80} className={control} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Store address
              <span className="flex items-center gap-1">
                <span className="text-muted">/s/</span>
                <input
                  name="slug"
                  pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
                  aria-describedby="slug-hint"
                  className={`${control} flex-1`}
                />
              </span>
              <span id="slug-hint" className="font-normal text-muted">
                Lowercase letters, numbers and hyphens. Leave empty to make one from the name.
              </span>
            </label>
            <div>
              <SubmitButton>Create store</SubmitButton>
            </div>
          </ActionForm>
        </section>
      )}
    </main>
  );
}
