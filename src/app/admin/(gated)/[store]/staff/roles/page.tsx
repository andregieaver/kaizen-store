import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { RoleEditor } from "@/components/admin/role-editor";
import { ROLE_TEMPLATES } from "@/lib/permissions";
import { roleSummary } from "@/lib/role-form";
import { requireOwnerRole } from "@/server/permissions";
import { ensureStoreRoles, listStoreRoles, roleHolders } from "@/server/store-roles";

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

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-sm">
          <Link href={`/admin/${slug}/staff`} className="underline">
            Team
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Roles</h1>
        <p className="max-w-2xl text-sm text-muted">
          A role says, for each part of the admin, whether someone can see it, change it, or not open it at all. Owners hold everything. An admin with no
          role of their own can do everything except the team and the plan. Changing a role changes what everyone who holds it can do, at once.
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {roles.map((role) => {
          const who = holders.get(role.id) ?? [];
          const template = role.template ? ROLE_TEMPLATES[role.template] : null;
          return (
            <li key={role.id} className="rounded-lg border border-border bg-background p-5">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{role.name}</span>
                  <span className="text-sm text-muted">
                    {who.length === 0 ? "Nobody holds it" : `${who.length} ${who.length === 1 ? "person holds" : "people hold"} it`}
                  </span>
                </summary>
                <p className="mt-2 text-sm text-muted">{roleSummary(role.permissions)}</p>
                {template && <p className="text-sm text-muted">{template.description}</p>}
                {who.length > 0 && <p className="mt-1 text-sm">Held by {who.map((h) => h.email).join(", ")}.</p>}
                <div className="mt-4 flex flex-col gap-4">
                  <RoleEditor action={updateRoleAction.bind(null, slug, role.id)} role={role} submitLabel="Save role" idPrefix={`role-${role.id}`} />
                  <ActionForm action={deleteRoleAction.bind(null, slug, role.id)} className="flex flex-wrap items-center gap-3">
                    <SubmitButton variant="secondary" disabled={who.length > 0}>
                      Delete role<span className="sr-only"> {role.name}</span>
                    </SubmitButton>
                    {who.length > 0 && <span className="text-sm text-muted">Give {who.length === 1 ? "them" : "everyone who holds it"} another role first.</span>}
                  </ActionForm>
                </div>
              </details>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="new-role-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="new-role-heading" className="mb-3 font-medium">
          Make a role
        </h2>
        <RoleEditor action={createRoleAction.bind(null, slug)} submitLabel="Make role" idPrefix="new-role" />
      </section>
    </div>
  );
}
