import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePermission } from "@/server/permissions";
import { listCompanies } from "@/server/companies";
import { getTier, tierMembers } from "@/server/customer-tiers";
import { PageHeader } from "@/components/admin/ui";

import { addToGroupAction, deleteGroupAction, removeFromGroupAction, saveGroupAction } from "../actions";

export const metadata: Metadata = { title: "Customer group" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const card = "flex flex-col gap-3 rounded-lg border border-line bg-card p-5";

export default async function CustomerGroupPage({ params }: PageProps<"/admin/[store]/customer-groups/[groupId]">) {
  const { store: slug, groupId } = await params;
  const gated = await requirePermission(slug, "customers:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const all = adminText(adminLangOf(gated.account.adminLocale), "customers");
  const words = all.group;
  if (!z.uuid().safeParse(groupId).success) notFound();
  const group = await getTier(store.id, groupId);
  if (!group) notFound();
  const [members, companies] = await Promise.all([tierMembers(store.id, group.id), listCompanies(store.id)]);
  const base = `/admin/${store.slug}`;
  const using = companies.filter((company) => company.tierId === group.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/customer-groups`, label: words.back }}
        title={<>{group.name}</>}
        description={fillWords(group.active ? words.description : words.descriptionOff, { percent: group.percent })}
      />

      <section aria-labelledby="settings" className={card}>
        <h2 id="settings" className="text-title text-ink">
          {words.settings}
        </h2>
        <ActionForm action={saveGroupAction.bind(null, store.slug, group.id)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {all.groups.name}
            <input name="name" required maxLength={80} defaultValue={group.name} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {all.groups.percent}
            <input name="percent" required inputMode="numeric" pattern="[0-9]{1,3}" defaultValue={group.percent} className={`${control} w-32`} />
            <span className="font-normal text-muted">{words.kept}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {all.groups.note}
            <input name="note" maxLength={300} defaultValue={group.note} className={control} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={group.active} className="size-4" />
            {words.switchedOn}
          </label>
          <div>
            <SubmitButton>{words.save}</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="customers" className={card}>
        <h2 id="customers" className="text-title text-ink">
          {fillWords(words.members, { n: members.length })}
        </h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted">{words.noOne}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <Link href={`${base}/customers/${member.id}`} className="font-medium underline-offset-2 hover:underline">
                    {member.name || member.email}
                  </Link>
                  {member.name && <span className="block truncate text-muted">{member.email}</span>}
                  {member.companyName && <span className="block text-xs text-muted">{fillWords(words.alsoIn, { company: member.companyName })}</span>}
                </span>
                <ActionForm action={removeFromGroupAction.bind(null, store.slug)} className="flex items-center">
                  <input type="hidden" name="customerId" value={member.id} />
                  <SubmitButton variant="secondary">
                    {words.remove}<span className="sr-only"> {member.email}</span>
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addToGroupAction.bind(null, store.slug, group.id)} className="flex flex-col gap-2 border-t border-line pt-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {words.addByEmail}
            <span className="flex flex-wrap gap-2">
              <input type="email" name="email" required className={`${control} min-w-64 flex-1`} />
              <SubmitButton variant="secondary">{words.add}</SubmitButton>
            </span>
            <span className="font-normal text-muted">{words.addHint}</span>
          </label>
        </ActionForm>
      </section>

      {using.length > 0 && (
        <section aria-labelledby="companies" className={card}>
          <h2 id="companies" className="text-title text-ink">
            {words.companies}
          </h2>
          <ul className="text-sm">
            {using.map((company) => (
              <li key={company.id}>
                <Link href={`${base}/companies/${company.id}`} className="underline">
                  {company.name}
                </Link>{" "}
                <span className="text-muted">
                  {fillWords(words.companyLine, { n: company.members, percent: company.employeeSharePercent })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="delete" className={card}>
        <h2 id="delete" className="text-title text-ink">
          {words.delete}
        </h2>
        <p className="text-sm text-muted">{words.deleteHint}</p>
        <ActionForm action={deleteGroupAction.bind(null, store.slug, group.id)}>
          <SubmitButton variant="secondary">{words.deleteButton}</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
