import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { listCompanies } from "@/server/companies";
import { getTier, tierMembers } from "@/server/customer-tiers";

import { addToGroupAction, deleteGroupAction, removeFromGroupAction, saveGroupAction } from "../actions";

export const metadata: Metadata = { title: "Customer group" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const card = "flex flex-col gap-3 rounded-lg border border-border bg-background p-5";

export default async function CustomerGroupPage({ params }: PageProps<"/admin/[store]/customer-groups/[groupId]">) {
  const { store: slug, groupId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(groupId).success) notFound();
  const group = await getTier(store.id, groupId);
  if (!group) notFound();
  const [members, companies] = await Promise.all([tierMembers(store.id, group.id), listCompanies(store.id)]);
  const base = `/admin/${store.slug}`;
  const using = companies.filter((company) => company.tierId === group.id);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href={`${base}/customer-groups`} className="text-sm underline">
          Customer groups
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{group.name}</h1>
        <p className="text-sm text-muted">
          {group.percent} % off what {group.active ? "its customers buy" : "customers would buy: the group is switched off, so it gives nothing now"}.
        </p>
      </div>

      <section aria-labelledby="settings" className={card}>
        <h2 id="settings" className="font-medium">
          Settings
        </h2>
        <ActionForm action={saveGroupAction.bind(null, store.slug, group.id)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Name
            <input name="name" required maxLength={80} defaultValue={group.name} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Discount, percent
            <input name="percent" required inputMode="numeric" pattern="[0-9]{1,3}" defaultValue={group.percent} className={`${control} w-32`} />
            <span className="font-normal text-muted">Orders already placed keep the discount they got.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Note (only staff see it)
            <input name="note" maxLength={300} defaultValue={group.note} className={control} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={group.active} className="size-4" />
            Switched on
          </label>
          <div>
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="customers" className={card}>
        <h2 id="customers" className="font-medium">
          Customers in this group ({members.length})
        </h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted">No one yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <Link href={`${base}/customers/${member.id}`} className="font-medium underline-offset-2 hover:underline">
                    {member.name || member.email}
                  </Link>
                  {member.name && <span className="block truncate text-muted">{member.email}</span>}
                  {member.companyName && <span className="block text-xs text-muted">Also in {member.companyName}: the better discount applies</span>}
                </span>
                <ActionForm action={removeFromGroupAction.bind(null, store.slug)} className="flex items-center">
                  <input type="hidden" name="customerId" value={member.id} />
                  <SubmitButton variant="secondary">
                    Remove<span className="sr-only"> {member.email}</span>
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addToGroupAction.bind(null, store.slug, group.id)} className="flex flex-col gap-2 border-t border-border pt-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Add a customer by email
            <span className="flex flex-wrap gap-2">
              <input type="email" name="email" required className={`${control} min-w-64 flex-1`} />
              <SubmitButton variant="secondary">Add</SubmitButton>
            </span>
            <span className="font-normal text-muted">Someone with no account gets one made, and the discount waits for them to sign in.</span>
          </label>
        </ActionForm>
      </section>

      {using.length > 0 && (
        <section aria-labelledby="companies" className={card}>
          <h2 id="companies" className="font-medium">
            Companies with this group
          </h2>
          <ul className="text-sm">
            {using.map((company) => (
              <li key={company.id}>
                <Link href={`${base}/companies/${company.id}`} className="underline">
                  {company.name}
                </Link>{" "}
                <span className="text-muted">
                  {company.members} accounts, employees get {company.employeeSharePercent} % of it
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="delete" className={card}>
        <h2 id="delete" className="font-medium">
          Delete the group
        </h2>
        <p className="text-sm text-muted">Only a group no customer or company is in can be deleted. Otherwise, switch it off above.</p>
        <ActionForm action={deleteGroupAction.bind(null, store.slug, group.id)}>
          <SubmitButton variant="secondary">Delete group</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
