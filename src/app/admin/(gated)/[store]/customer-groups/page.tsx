import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePermission } from "@/server/permissions";
import { listTiers } from "@/server/customer-tiers";
import { Card, CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { saveGroupAction } from "./actions";

export const metadata: Metadata = { title: "Customer groups" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * Discount groups (D108): a fixed percentage off for the customers in them,
 * such as wholesale customers. Put customers in a group here, or give a
 * company a group so its accounts share the discount.
 */
export default async function CustomerGroupsPage({ params }: PageProps<"/admin/[store]/customer-groups">) {
  const gated = await requirePermission((await params).store, "customers:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const words = adminText(adminLangOf(gated.account.adminLocale), "customers").groups;
  const groups = await listTiers(store.id);
  const base = `/admin/${store.slug}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={words.title}
        description={<>{words.descriptionBefore}<Link href={`${base}/companies`} className="underline">{words.descriptionLink}</Link>{words.descriptionAfter}</>}
      />

      {groups.length === 0 ? (
        <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
          {words.none}
        </p>
      ) : (
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

      <Card title={words.newGroup} className="flex max-w-xl flex-col gap-3" compact>
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
      </Card>
    </div>
  );
}
