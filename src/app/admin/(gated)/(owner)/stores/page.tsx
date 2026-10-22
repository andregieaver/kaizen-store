import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DesignCards } from "@/components/admin/design-cards";
import { StoresList } from "@/components/admin/stores-list";
import { listClosedStores, listStores, requireAccount } from "@/server/auth";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { copyProgressPath } from "@/lib/store-copy-paths";
import { listHostings } from "@/server/hosts";
import { MAX_STORES_PER_OWNER } from "@/server/platform";
import { listStoreCopies } from "@/server/store-copy";
import { designChoices } from "@/server/design-presets";
import { Card, CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { createStoreAction } from "./actions";

export const metadata: Metadata = { title: "Your stores" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** All the account's stores, and a way to create another. */
export default async function AllStoresPage() {
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const words = adminText(lang, "home");
  const { stores: w, common: c } = words;
  const [stores, hostings, copies, closed] = await Promise.all([listStores(account), listHostings(account), listStoreCopies(account), listClosedStores(account)]);
  const owned = stores.filter((store) => store.role === "owner").length;
  const canCreate = account.platformAdmin || (owned > 0 && owned < MAX_STORES_PER_OWNER);
  // Duplicating (D129) makes one more store, so it has the same room as creating one.
  const canDuplicate = account.platformAdmin || (owned > 0 && owned < MAX_STORES_PER_OWNER);
  const full = !account.platformAdmin && owned >= MAX_STORES_PER_OWNER;
  // The store templates to start from (D175): the Standard store and the published ones.
  // The design profiles to apply after (D176): keep the template's own look first; a template may recommend one.
  const designs = canCreate ? await designChoices() : { cards: [] };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.title} description={w.description} />
      <StoresList stores={stores} canDuplicate={canDuplicate} platformAdmin={account.platformAdmin} words={w} />
      {full && (
        <p role="note" className="max-w-xl text-sm text-muted">
          {fillWords(w.max, { max: MAX_STORES_PER_OWNER })}
        </p>
      )}

      {canCreate && (
        <Card title={w.createTitle} description={w.createDescription} className="flex max-w-3xl flex-col gap-3" compact>
          <ActionForm action={createStoreAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.name}
              <input name="name" required maxLength={80} className={control} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.address}
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
                {w.addressHint}
              </span>
            </label>
            {designs.cards.length > 1 && (
              <DesignCards
                cards={designs.cards}
                hint={w.designHint}
              />
            )}
            <div>
              <SubmitButton>{w.create}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
      {closed.length > 0 && (
        <section aria-labelledby="closed-heading" className="flex flex-col gap-2">
          <h2 id="closed-heading" className="text-title text-ink">
            {w.closed}
          </h2>
          <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {closed.map((c) => (
              <li key={c.slug} className="p-4">
                <Link href={`/admin/${c.slug}`} className="font-medium underline-offset-2 hover:underline">
                  {c.name}
                </Link>
                <span className="block text-muted">
                  {c.closedAt
                    ? fillWords(w.closedOn, { date: c.closedAt.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) })
                    : w.closedPlain}{" "}
                  {c.role === "owner" ? w.closedOwner : w.closedStaff}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {copies.length > 0 && (
        <section aria-labelledby="copies-heading" className="flex flex-col gap-2">
          <h2 id="copies-heading" className="text-title text-ink">
            {w.copies}
          </h2>
          <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {copies.map((copy) => (
              <li key={copy.id} className="p-4">
                <Link href={copyProgressPath(copy.id)} className="font-medium underline-offset-2 hover:underline">
                  {copy.newName}
                </Link>
                <span className="block text-muted">
                  {fillWords(w.copyOf, { name: copy.sourceName })} ·{" "}
                  {copy.status === "failed" ? w.copyFailed : copy.status === "done" ? w.copyDone : w.phases[copy.phase]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {hostings.length > 0 && (
        <section aria-labelledby="hosting-heading" className="flex flex-col gap-2">
          <h2 id="hosting-heading" className="text-title text-ink">
            {c.hosting}
          </h2>
          <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {hostings.map((h) => (
              <li key={h.slug} className="p-4">
                <Link href={`/admin/hosting/${h.slug}`} className="font-medium underline-offset-2 hover:underline">
                  {h.name}
                </Link>
                <span className="block text-muted">{fillWords(c.asHost, { name: h.hostName })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
