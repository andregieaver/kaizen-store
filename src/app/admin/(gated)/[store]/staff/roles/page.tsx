import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { RoleEditor } from "@/components/admin/role-editor";
import { roleSummary } from "@/lib/role-form";
import { requireOwnerRole } from "@/server/permissions";
import { ensureStoreRoles, listStoreRoles, roleHolders } from "@/server/store-roles";
import { Card, CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { roleDescriptionIn, roleNameIn } from "@/lib/staff-words";

import { createRoleAction, deleteRoleAction, updateRoleAction } from "../actions";

export const metadata: Metadata = { title: "Roles" };

/**
 * The store's roles (wave 1, 1f, docs/wave-1-trust.md 2.7): what each can see and change, per area, made from six templates the owner can
 * edit or delete. A role in use cannot be deleted; it says who holds it. The owner's page, like the team.
 */
export default async function RolesPage({ params }: PageProps<"/admin/[store]/staff/roles">) {
  const { account, store } = await requireOwnerRole((await params).store);
  await ensureStoreRoles(store.id, account.id);
  const roles = await listStoreRoles(store.id);
  const holders = new Map(await Promise.all(roles.map(async (r) => [r.id, await roleHolders(store.id, r.id)] as const)));
  const slug = store.slug;
  const words = adminText(adminLangOf(account.adminLocale), "staff");
  const w = words.rolesPage;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-sm">
          <Link href={`/admin/${slug}/staff`} className="underline">
            {words.team.title}
          </Link>
        </p>
        <PageHeader
          title={w.title}
          description={<><span className="sm:hidden">{w.phone.lead}</span><span className="max-sm:hidden">{w.description}</span></>}
        />
        </div>

      {/* On a phone (round 42, D739) the roles are rows of one card, and making one is a row under them. */}
      <ul className="flex flex-col gap-4 max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-panel max-sm:border max-sm:border-line max-sm:bg-card">
        {roles.map((role) => {
          const who = holders.get(role.id) ?? [];
          const name = roleNameIn(role.name, words);
          return (
            <li key={role.id} className={`p-5 ${CARD_CLASS} max-sm:rounded-none max-sm:border-0 max-sm:border-b max-sm:border-line max-sm:px-4 max-sm:py-3.5 max-sm:shadow-none max-sm:last:border-b-0`}>
              <details>
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{name}</span>
                  <span className="text-sm text-muted">
                    {who.length === 0 ? w.nobody : countWords(who.length, w.holds)}
                  </span>
                </summary>
                <p className="mt-2 text-sm text-muted">{roleSummary(role.permissions, words)}</p>
                {role.template && <p className="text-sm text-muted">{roleDescriptionIn(role.template, words)}</p>}
                {who.length > 0 && <p className="mt-1 text-sm">{fillWords(w.heldBy, { emails: who.map((h) => h.email).join(", ") })}</p>}
                <div className="mt-4 flex flex-col gap-4">
                  <RoleEditor action={updateRoleAction.bind(null, slug, role.id)} role={role} submitLabel={w.save} idPrefix={`role-${role.id}`} words={words} />
                  <ActionForm action={deleteRoleAction.bind(null, slug, role.id)} className="flex flex-wrap items-center gap-3">
                    <SubmitButton variant="secondary" disabled={who.length > 0}>
                      {w.delete}<span className="sr-only"> {name}</span>
                    </SubmitButton>
                    {who.length > 0 && <span className="text-sm text-muted">{countWords(who.length, w.giveOther)}</span>}
                  </ActionForm>
                </div>
              </details>
            </li>
          );
        })}
      </ul>

      <PhoneRows>
        <PhoneRow flat last title={w.make} sub={w.phone.makeSub} change={w.phone.make} done={w.phone.close}>
          <Card title={w.make} compact>
            <RoleEditor action={createRoleAction.bind(null, slug)} submitLabel={w.makeButton} idPrefix="new-role" words={words} />
          </Card>
        </PhoneRow>
      </PhoneRows>
    </div>
  );
}
