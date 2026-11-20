import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { requirePermission } from "@/server/permissions";
import { listTiers } from "@/server/customer-tiers";
import { ButtonLink, CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { countWords } from "@/lib/admin-fill";
import { CUSTOMERS_WORDS } from "@/lib/admin-words/customers";

import { saveGroupAction } from "./actions";

export const metadata: Metadata = { title: "Customer groups" };

/** Groups most shops keep (round 11, D634), each made in one press at its usual percentage; changed on the group's page. */
const READY = [
  { key: "wholesale", percent: 10 },
  { key: "staff", percent: 20 },
  { key: "regulars", percent: 5 },
  { key: "family", percent: 15 },
] as const;

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * Discount groups (D108): a fixed percentage off for the customers in them,
 * such as wholesale customers. Put customers in a group here, or give a
 * company a group so its accounts share the discount.
 */
export default async function CustomerGroupsPage({ params, searchParams }: PageProps<"/admin/[store]/customer-groups">) {
  const gated = await requirePermission((await params).store, "customers:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const words = CUSTOMERS_WORDS[adminLangOf(gated.account.adminLocale)].groups;
  const groups = await listTiers(store.id);
  const base = `/admin/${store.slug}`;
  const live = groups.filter((g) => g.active).length;
  const taken = new Set(groups.map((g) => g.name.trim().toLowerCase()));
  const ready = READY.filter((r) => !taken.has(words.ready[r.key].name.toLowerCase()));
  const own = (await searchParams).own === "1";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={words.title}
        meta={[
          <span key="lead">
            <span className="text-ink">{live === 0 ? words.leadNone : countWords(live, words.leadSome)}</span>
            {words.leadRest}
          </span>,
        ]}
        actions={
          <ButtonLink kind="secondary" href="?own=1#own">
            {words.makeOwn}
          </ButtonLink>
        }
      />
      {groups.length > 0 && (
        <div className={`overflow-x-auto ${CARD_CLASS}`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-2 font-medium">{words.columns.group}</th>
                <th scope="col" className="px-4 py-2 font-medium">{words.columns.discount}</th>
                <th scope="col" className="px-4 py-2 font-medium">{words.columns.customers}</th>
                <th scope="col" className="px-4 py-2 font-medium">{words.columns.companies}</th>
                <th scope="col" className="px-4 py-2 font-medium">{words.columns.status}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`${base}/customer-groups/${group.id}`} className="font-medium underline-offset-2 hover:underline">
                      {group.name}
                    </Link>
                    {group.note && <span className="block text-xs text-muted">{group.note}</span>}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{group.percent} %</td>
                  <td className="px-4 py-2 tabular-nums">{group.customers}</td>
                  <td className="px-4 py-2 tabular-nums">{group.companies}</td>
                  <td className="px-4 py-2">{group.active ? words.active : words.switchedOff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ready.length > 0 && (
        <section aria-labelledby="ready-groups" className="flex flex-col gap-3">
          <h2 id="ready-groups" className="text-title text-ink">
            {words.readyTitle}
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] gap-3">
            {ready.map((r, i) => (
              <li key={r.key} className={`flex flex-col gap-2 p-5 ${CARD_CLASS}`}>
                <span aria-hidden className="text-2xl tracking-tight text-ink">{r.percent} %</span>
                <span className="text-body text-ink">{words.ready[r.key].name}</span>
                <span className="text-caption text-ink-2">{words.ready[r.key].sub}</span>
                <ActionForm action={saveGroupAction.bind(null, store.slug, null)} className="mt-auto">
                  <input type="hidden" name="name" value={words.ready[r.key].name} />
                  <input type="hidden" name="percent" value={r.percent} />
                  <SubmitButton variant={i === 0 && groups.length === 0 ? "primary" : "secondary"}>
                    {words.makeIt}
                    <span className="sr-only"> {words.ready[r.key].name}</span>
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Make your own (round 11, D634): the form and what the percentage covers, one press away; open from the header's button. */}
      <details id="own" open={own} className={`group max-w-xl ${CARD_CLASS}`}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center px-6 py-3 text-body text-ink [&::-webkit-details-marker]:hidden">
          {words.makeOwn}
        </summary>
        <div className="flex flex-col gap-3 px-6 pb-6">
          <p className="text-sm text-muted">
            {words.descriptionBefore}
            <Link href={`${base}/companies`} className="underline">{words.descriptionLink}</Link>
            {words.descriptionAfter}
          </p>
          <ActionForm action={saveGroupAction.bind(null, store.slug, null)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {words.name}
              <input name="name" required maxLength={80} placeholder={words.namePlaceholder} className={control} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {words.percent}
              <input name="percent" required inputMode="numeric" pattern="[0-9]{1,3}" placeholder="10" className={`${control} w-32`} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {words.note}
              <input name="note" maxLength={300} className={control} />
            </label>
            <div>
              <SubmitButton>{words.make}</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </details>
    </div>
  );
}
