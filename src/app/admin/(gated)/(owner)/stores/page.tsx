import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DesignCards } from "@/components/admin/design-cards";
import { StarterCards } from "@/components/admin/starter-cards";
import { StoresList } from "@/components/admin/stores-list";
import { listClosedStores, listStores, requireAccount } from "@/server/auth";
import { COPY_PHASE_LABELS } from "@/lib/store-copy";
import { copyProgressPath } from "@/lib/store-copy-paths";
import { listHostings } from "@/server/hosts";
import { MAX_STORES_PER_OWNER } from "@/server/platform";
import { listStoreCopies } from "@/server/store-copy";
import { designChoices } from "@/server/design-presets";
import { starterCards } from "@/server/store-starters";

import { createStoreAction } from "./actions";

export const metadata: Metadata = { title: "Your stores" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/** All the account's stores, and a way to create another. */
export default async function AllStoresPage() {
  const account = await requireAccount();
  const [stores, hostings, copies, closed] = await Promise.all([listStores(account), listHostings(account), listStoreCopies(account), listClosedStores(account)]);
  const owned = stores.filter((store) => store.role === "owner").length;
  const canCreate = account.platformAdmin || (owned > 0 && owned < MAX_STORES_PER_OWNER);
  // Duplicating (D129) makes one more store, so it has the same room as creating one.
  const canDuplicate = account.platformAdmin || (owned > 0 && owned < MAX_STORES_PER_OWNER);
  const full = !account.platformAdmin && owned >= MAX_STORES_PER_OWNER;
  // The store templates to start from (D175): the Standard store and the published ones.
  const cards = canCreate ? await starterCards() : [];
  // The design profiles to apply after (D176): keep the template's own look first; a template may recommend one.
  const designs = canCreate ? await designChoices() : { cards: [], recommended: {} };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Your stores</h1>
        <p className="text-sm text-muted">Each store has its own products, Stripe account and plan.</p>
      </div>
      <StoresList stores={stores} canDuplicate={canDuplicate} platformAdmin={account.platformAdmin} />
      {full && (
        <p role="note" className="max-w-xl text-sm text-muted">
          You can own up to {MAX_STORES_PER_OWNER} stores. Contact Kaizen for more. Creating or duplicating a store is switched off until then.
        </p>
      )}

      {canCreate && (
        <section aria-labelledby="new-store" className="flex max-w-3xl flex-col gap-3 rounded-lg border border-border bg-background p-5">
          <div>
            <h2 id="new-store" className="font-medium">
              Create a store
            </h2>
            <p className="text-sm text-muted">
              It starts as a copy of the store template you choose, with you as owner: its products and services, staff,
              pages, menus and settings, ready to change. You then add your business details, set up payments and choose
              its plan.
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
            <StarterCards cards={cards} hint="Preview opens a template's store in a new window, to look around before you choose." />
            {designs.cards.length > 1 && (
              <DesignCards
                cards={designs.cards}
                recommended={designs.recommended}
                legend="Design profile"
                hint="The look only: colours, fonts, header, footer and product page. Your products, pages and menus are the template's. Preview opens it in a new window."
              />
            )}
            <div>
              <SubmitButton>Create store</SubmitButton>
            </div>
          </ActionForm>
        </section>
      )}
      {closed.length > 0 && (
        <section aria-labelledby="closed-heading" className="flex flex-col gap-2">
          <h2 id="closed-heading" className="text-lg font-semibold">
            Closed stores
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {closed.map((c) => (
              <li key={c.slug} className="p-4">
                <Link href={`/admin/${c.slug}`} className="font-medium underline-offset-2 hover:underline">
                  {c.name}
                </Link>
                <span className="block text-muted">
                  Closed{c.closedAt ? ` ${c.closedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}` : ""}. Open it to see its orders and invoices
                  {c.role === "owner" ? ", or to reopen it." : "."}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {copies.length > 0 && (
        <section aria-labelledby="copies-heading" className="flex flex-col gap-2">
          <h2 id="copies-heading" className="text-lg font-semibold">
            Recent copies
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {copies.map((copy) => (
              <li key={copy.id} className="p-4">
                <Link href={copyProgressPath(copy.id)} className="font-medium underline-offset-2 hover:underline">
                  {copy.newName}
                </Link>
                <span className="block text-muted">
                  Copy of {copy.sourceName} ·{" "}
                  {copy.status === "failed" ? "Failed" : copy.status === "done" ? "Done" : COPY_PHASE_LABELS[copy.phase]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {hostings.length > 0 && (
        <section aria-labelledby="hosting-heading" className="flex flex-col gap-2">
          <h2 id="hosting-heading" className="text-lg font-semibold">
            Hosting
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {hostings.map((h) => (
              <li key={h.slug} className="p-4">
                <Link href={`/admin/hosting/${h.slug}`} className="font-medium underline-offset-2 hover:underline">
                  {h.name}
                </Link>
                <span className="block text-muted">As {h.hostName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
