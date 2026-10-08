import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { requirePermission } from "@/server/permissions";
import { listTiers } from "@/server/customer-tiers";

import { saveGroupAction } from "./actions";

export const metadata: Metadata = { title: "Customer groups" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

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
  const groups = await listTiers(store.id);
  const base = `/admin/${store.slug}`;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Customer groups</h1>
        <p className="text-sm text-muted">
          A fixed percentage off everything a customer in the group buys once (not subscriptions, sign-up fees or shipping), taken off before any coupon.
          Put customers in a group, or give a <Link href={`${base}/companies`} className="underline">company</Link> a group so all its accounts share the discount.
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
          No groups yet. Make one, for example Wholesale at 10 %.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">Group</th>
                <th scope="col" className="px-4 py-2 font-medium">Discount</th>
                <th scope="col" className="px-4 py-2 font-medium">Customers</th>
                <th scope="col" className="px-4 py-2 font-medium">Companies</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`${base}/customer-groups/${group.id}`} className="font-medium underline-offset-2 hover:underline">
                      {group.name}
                    </Link>
                    {group.note && <span className="block text-xs text-muted">{group.note}</span>}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{group.percent} %</td>
                  <td className="px-4 py-2 tabular-nums">{group.customers}</td>
                  <td className="px-4 py-2 tabular-nums">{group.companies}</td>
                  <td className="px-4 py-2">{group.active ? "Active" : "Switched off"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section aria-labelledby="new-group" className="flex max-w-xl flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h2 id="new-group" className="font-medium">
          New group
        </h2>
        <ActionForm action={saveGroupAction.bind(null, store.slug, null)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Name
            <input name="name" required maxLength={80} placeholder="Wholesale" className={control} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Discount, percent
            <input name="percent" required inputMode="numeric" pattern="[0-9]{1,3}" placeholder="10" className={`${control} w-32`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Note (only staff see it)
            <input name="note" maxLength={300} className={control} />
          </label>
          <div>
            <SubmitButton>Make group</SubmitButton>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
