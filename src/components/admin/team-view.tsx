import type { ReactNode } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Avatar } from "@/components/avatar";
import { COLLABORATOR_DAYS, accessEnded } from "@/lib/permissions";
import { roleChoiceValue } from "@/lib/role-form";
import { avatarFor } from "@/server/avatars";
import type { StaffMember } from "@/server/settings";
import type { StoreRole } from "@/server/store-roles";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const field = "min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal";
const badge = "rounded-full border border-border px-2 py-0.5 text-xs text-muted";

/** The options of a role select: owner (unless a collaborator), the default admin set, and the store's roles. */
export function RoleOptions({ roles, collaborator = false }: { roles: readonly Pick<StoreRole, "id" | "name">[]; collaborator?: boolean }): ReactNode {
  return (
    <>
      {!collaborator && <option value="owner">Owner</option>}
      <option value="admin">Admin (everything except the team and the plan)</option>
      {roles.map((role) => (
        <option key={role.id} value={roleChoiceValue({ kind: "role", roleId: role.id })}>
          {role.name}
        </option>
      ))}
    </>
  );
}

const day = (iso: string | null | undefined, zone: string) => (iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: zone }).format(new Date(iso)) : "");

/** A member's role as the Team page says it, with no control: "Owner", "Admin", or the custom role's name. */
export const roleLabel = (member: Pick<StaffMember, "role" | "roleName">): string => (member.role === "owner" ? "Owner" : (member.roleName ?? "Admin"));

/**
 * The members of a store (wave 1, 1f, `docs/wave-1-trust.md` 2.7): each with their role, a Collaborator badge and end date, and whether they
 * have two-step sign-in; an owner changes a role, extends a collaborator or removes access. People whose access has ended are listed apart.
 */
export function TeamList({
  members,
  roles,
  viewerId,
  now,
  zone,
  actions,
}: {
  members: readonly StaffMember[];
  roles: readonly Pick<StoreRole, "id" | "name">[];
  viewerId: string;
  now: Date;
  zone: string;
  actions: { assign: Action; extend: Action; disable: Action };
}) {
  const ended = (m: StaffMember) => m.disabled || (m.kind === "collaborator" && accessEnded(m.expiresAt ? new Date(m.expiresAt) : null, now));
  const active = members.filter((m) => !ended(m));
  const past = members.filter(ended);
  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-border">
        {active.map((member) => (
          <li key={member.accountId} className="flex flex-col gap-3 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar avatar={avatarFor(member)} size={40} />
                <div className="min-w-0">
                  <p className="font-medium break-words">{member.name ? `${member.name} (${member.email})` : member.email}</p>
                  <p className="flex flex-wrap items-center gap-2 text-muted">
                    <span>{roleLabel(member)}</span>
                    {member.kind === "collaborator" && <span className={badge}>Collaborator until {day(member.expiresAt, zone)}</span>}
                    <span className={badge}>{member.hasTwoStep ? "Two-step on" : "No two-step"}</span>
                    {!member.signedInBefore && <span>not signed in yet</span>}
                  </p>
                </div>
              </div>
              {member.accountId !== viewerId && (
                <ActionForm action={actions.disable} className="flex items-center gap-2">
                  <input type="hidden" name="accountId" value={member.accountId} />
                  <SubmitButton variant="secondary">
                    Remove access<span className="sr-only"> for {member.email}</span>
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
            <div className="flex flex-wrap items-start gap-4">
              <ActionForm action={actions.assign} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="accountId" value={member.accountId} />
                <label className="flex items-center gap-2">
                  <span className="sr-only">Role of {member.email}</span>
                  <select
                    name="role"
                    defaultValue={member.role === "owner" ? "owner" : member.roleId ? roleChoiceValue({ kind: "role", roleId: member.roleId }) : "admin"}
                    className={field}
                  >
                    <RoleOptions roles={roles} collaborator={member.kind === "collaborator"} />
                  </select>
                </label>
                <SubmitButton variant="secondary">
                  Change role<span className="sr-only"> of {member.email}</span>
                </SubmitButton>
              </ActionForm>
              {member.kind === "collaborator" && (
                <ActionForm action={actions.extend} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="accountId" value={member.accountId} />
                  <label className="flex items-center gap-2">
                    <span>Days from today</span>
                    <input type="number" name="days" min={COLLABORATOR_DAYS.min} max={COLLABORATOR_DAYS.max} defaultValue={COLLABORATOR_DAYS.default} required className={`${field} w-24`} />
                  </label>
                  <SubmitButton variant="secondary">
                    Extend<span className="sr-only"> access for {member.email}</span>
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          </li>
        ))}
      </ul>
      {past.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">Access ended</h3>
          <ul className="divide-y divide-border">
            {past.map((member) => (
              <li key={member.accountId} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm text-muted">
                <span className="break-words">{member.name ? `${member.name} (${member.email})` : member.email}</span>
                <span>
                  {member.kind === "collaborator" && !member.disabled ? `Collaborator access ended ${day(member.expiresAt, zone)}` : "Access removed"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The forms that bring someone in: as staff, or as a collaborator with an end date. */
export function InviteForms({ roles, actions }: { roles: readonly Pick<StoreRole, "id" | "name">[]; actions: { staff: Action; collaborator: Action } }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="invite-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="invite-heading" className="mb-1 font-medium">
          Invite someone
        </h2>
        <p className="mb-3 text-sm text-muted">Staff keep their access until you remove it.</p>
        <ActionForm action={actions.staff} className="flex flex-col gap-3 sm:max-w-md">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Email
            <input type="email" name="email" required className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Role
            <select name="role" defaultValue="admin" className={field}>
              <RoleOptions roles={roles} />
            </select>
          </label>
          <div>
            <SubmitButton>Invite</SubmitButton>
          </div>
        </ActionForm>
      </section>
      <section aria-labelledby="collaborator-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="collaborator-heading" className="mb-1 font-medium">
          Invite a collaborator
        </h2>
        <p className="mb-3 text-sm text-muted">
          For an agency or a freelancer: access with a role you choose and an end date. A collaborator is never an owner and never sees the team or the plan.
        </p>
        <ActionForm action={actions.collaborator} className="flex flex-col gap-3 sm:max-w-md">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Email
            <input type="email" name="email" required className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Role
            <select name="role" defaultValue="admin" className={field}>
              <RoleOptions roles={roles} collaborator />
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Access lasts (days)
            <input type="number" name="days" min={COLLABORATOR_DAYS.min} max={COLLABORATOR_DAYS.max} defaultValue={COLLABORATOR_DAYS.default} required className={`${field} w-28`} />
            <span className="text-xs font-normal text-muted">1 to {COLLABORATOR_DAYS.max}. You can extend it, or remove access earlier.</span>
          </label>
          <div>
            <SubmitButton>Invite collaborator</SubmitButton>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}

/** The store's requirement of two-step sign-in, with how many of the team have it. */
export function TwoStepRequirement({
  required,
  withIt,
  total,
  action,
}: {
  required: boolean;
  withIt: number;
  total: number;
  action: Action;
}) {
  return (
    <section aria-labelledby="two-step-heading" className="rounded-lg border border-border bg-background p-5">
      <h2 id="two-step-heading" className="mb-1 font-medium">
        Two-step sign-in
      </h2>
      <p className="mb-3 text-sm text-muted">
        {withIt} of {total} {total === 1 ? "person" : "people"} on the team {withIt === 1 ? "has" : "have"} it. Everyone who has it is asked for a code whatever you choose here.
        Platform admins must use it. People set it up themselves on Your account.
      </p>
      <ActionForm action={action} className="flex flex-col gap-3">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="required" defaultChecked={required} className="mt-1 size-4" />
          <span>
            <span className="font-medium">Require two-step sign-in of everyone who works in this store.</span>
            <span className="block text-muted">
              Anyone without it is taken to set it up before they reach the store. Your other stores are not affected. You need it on yourself first.
            </span>
          </span>
        </label>
        <div>
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}
