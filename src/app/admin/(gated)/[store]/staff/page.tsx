import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { listStaff } from "@/server/settings";

import { disableStaffAction, inviteStaffAction } from "../../actions";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage({ params }: PageProps<"/admin/[store]/staff">) {
  const { account, store, role } = await requireMember((await params).store);
  const members = await listStaff(store.id);
  const isOwner = role === "owner";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Staff</h1>
        <p className="text-sm text-muted">
          People listed here can sign in with a link sent to their email. Owners manage staff and
          payment keys; admins manage everything else.
        </p>
      </div>

      <section aria-labelledby="members-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="members-heading" className="sr-only">
          Members
        </h2>
        <ul className="divide-y divide-border">
          {members.map((member) => (
            <li key={member.accountId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <p className="font-medium">{member.email}</p>
                <p className="text-muted">
                  {member.role}
                  {member.disabled ? " · access removed" : member.signedInBefore ? "" : " · not signed in yet"}
                </p>
              </div>
              {isOwner && !member.disabled && member.accountId !== account.id && (
                <ActionForm
                  action={disableStaffAction.bind(null, store.slug)}
                  className="flex items-center gap-2"
                >
                  <input type="hidden" name="accountId" value={member.accountId} />
                  <SubmitButton variant="secondary">
                    Remove access<span className="sr-only"> for {member.email}</span>
                  </SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isOwner && (
        <section aria-labelledby="invite-heading" className="rounded-lg border border-border bg-background p-5">
          <h2 id="invite-heading" className="mb-3 font-medium">
            Invite someone
          </h2>
          <ActionForm action={inviteStaffAction.bind(null, store.slug)} className="flex flex-col gap-3 sm:max-w-md">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Email
              <input
                type="email"
                name="email"
                required
                className="min-h-10 rounded-md border border-border bg-background px-3 font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Role
              <select name="role" defaultValue="admin" className="min-h-10 rounded-md border border-border bg-background px-3 font-normal">
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </label>
            <div>
              <SubmitButton>Invite</SubmitButton>
            </div>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
