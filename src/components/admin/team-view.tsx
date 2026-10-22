import type { ReactNode } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Avatar } from "@/components/avatar";
import { COLLABORATOR_DAYS, accessEnded } from "@/lib/permissions";
import { roleChoiceValue } from "@/lib/role-form";
import { countWords, fillWords } from "@/lib/admin-fill";
import { staffEn, type StaffMessages } from "@/lib/admin-messages/staff.en";
import { roleNameIn } from "@/lib/staff-words";
import { avatarFor } from "@/server/avatars";
import type { StaffMember } from "@/server/settings";
import type { StoreRole } from "@/server/store-roles";
import { Card } from "@/components/admin/ui";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const field = "min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";
const badge = "rounded-full border border-line px-2 py-0.5 text-xs text-muted";

/** The options of a role select: owner (unless a collaborator), the default admin set, and the store's roles. */
export function RoleOptions({
  roles,
  collaborator = false,
  words,
}: {
  roles: readonly Pick<StoreRole, "id" | "name">[];
  collaborator?: boolean;
  /** The account's words (D312 A8); English unless given. */
  words?: StaffMessages;
}): ReactNode {
  const w = words ?? staffEn;
  return (
    <>
      {!collaborator && <option value="owner">{w.roles.owner}</option>}
      <option value="admin">{w.roles.adminLong}</option>
      {roles.map((role) => (
        <option key={role.id} value={roleChoiceValue({ kind: "role", roleId: role.id })}>
          {roleNameIn(role.name, words)}
        </option>
      ))}
    </>
  );
}

const day = (iso: string | null | undefined, zone: string, locale = "en-GB") =>
  iso ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: zone }).format(new Date(iso)) : "";

/** A member's role as the Team page says it, with no control: "Owner", "Admin", or the custom role's name. */
export const roleLabel = (member: Pick<StaffMember, "role" | "roleName">, words?: StaffMessages): string => {
  const w = words ?? staffEn;
  return member.role === "owner" ? w.roles.owner : member.roleName ? roleNameIn(member.roleName, words) : w.roles.admin;
};

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
  words,
  locale,
}: {
  members: readonly StaffMember[];
  roles: readonly Pick<StoreRole, "id" | "name">[];
  viewerId: string;
  now: Date;
  zone: string;
  actions: { assign: Action; extend: Action; disable: Action };
  /** The account's words (D312 A8); English unless given. */
  words?: StaffMessages;
  /** How dates are written in them. */
  locale?: string;
}) {
  const w = (words ?? staffEn).team;
  const ended = (m: StaffMember) => m.disabled || (m.kind === "collaborator" && accessEnded(m.expiresAt ? new Date(m.expiresAt) : null, now));
  const active = members.filter((m) => !ended(m));
  const past = members.filter(ended);
  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-line">
        {active.map((member) => (
          <li key={member.accountId} className="flex flex-col gap-3 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar avatar={avatarFor(member)} size={40} />
                <div className="min-w-0">
                  <p className="font-medium break-words">{member.name ? `${member.name} (${member.email})` : member.email}</p>
                  <p className="flex flex-wrap items-center gap-2 text-muted">
                    <span>{roleLabel(member, words)}</span>
                    {member.kind === "collaborator" && <span className={badge}>{fillWords(w.collaboratorUntil, { date: day(member.expiresAt, zone, locale) })}</span>}
                    <span className={badge}>{member.hasTwoStep ? w.twoStepOn : w.noTwoStep}</span>
                    {!member.signedInBefore && <span>{w.notSignedIn}</span>}
                  </p>
                </div>
              </div>
              {member.accountId !== viewerId && (
                <ActionForm action={actions.disable} className="flex items-center gap-2">
                  <input type="hidden" name="accountId" value={member.accountId} />
                  <SubmitButton variant="secondary">
                    {w.removeAccess}<span className="sr-only">{fillWords(w.forEmail, { email: member.email })}</span>
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
            <div className="flex flex-wrap items-start gap-4">
              <ActionForm action={actions.assign} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="accountId" value={member.accountId} />
                <label className="flex items-center gap-2">
                  <span className="sr-only">{fillWords(w.roleOf, { email: member.email })}</span>
                  <select
                    name="role"
                    defaultValue={member.role === "owner" ? "owner" : member.roleId ? roleChoiceValue({ kind: "role", roleId: member.roleId }) : "admin"}
                    className={field}
                  >
                    <RoleOptions roles={roles} collaborator={member.kind === "collaborator"} words={words} />
                  </select>
                </label>
                <SubmitButton variant="secondary">
                  {w.changeRole}<span className="sr-only">{fillWords(w.ofEmail, { email: member.email })}</span>
                </SubmitButton>
              </ActionForm>
              {member.kind === "collaborator" && (
                <ActionForm action={actions.extend} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="accountId" value={member.accountId} />
                  <label className="flex items-center gap-2">
                    <span>{w.daysFromToday}</span>
                    <input type="number" name="days" min={COLLABORATOR_DAYS.min} max={COLLABORATOR_DAYS.max} defaultValue={COLLABORATOR_DAYS.default} required className={`${field} w-24`} />
                  </label>
                  <SubmitButton variant="secondary">
                    {w.extend}<span className="sr-only">{fillWords(w.accessFor, { email: member.email })}</span>
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          </li>
        ))}
      </ul>
      {past.length > 0 && (
        <div>
          <h3 className="mb-2 text-muted text-body-strong text-ink">{w.accessEnded}</h3>
          <ul className="divide-y divide-line">
            {past.map((member) => (
              <li key={member.accountId} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm text-muted">
                <span className="break-words">{member.name ? `${member.name} (${member.email})` : member.email}</span>
                <span>
                  {member.kind === "collaborator" && !member.disabled ? fillWords(w.collaboratorEnded, { date: day(member.expiresAt, zone, locale) }) : w.accessRemoved}
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
export function InviteForms({
  roles,
  actions,
  words,
}: {
  roles: readonly Pick<StoreRole, "id" | "name">[];
  actions: { staff: Action; collaborator: Action };
  /** The account's words (D312 A8); English unless given. */
  words?: StaffMessages;
}) {
  const w = (words ?? staffEn).invite;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={w.title} compact>
        <p className="mb-3 text-sm text-muted">{w.staffNote}</p>
        <ActionForm action={actions.staff} className="flex flex-col gap-3 sm:max-w-md">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.email}
            <input type="email" name="email" required className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.role}
            <select name="role" defaultValue="admin" className={field}>
              <RoleOptions roles={roles} words={words} />
            </select>
          </label>
          <div>
            <SubmitButton>{w.invite}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
      <Card title={w.collaboratorTitle} compact>
        <p className="mb-3 text-sm text-muted">
          {w.collaboratorNote}
        </p>
        <ActionForm action={actions.collaborator} className="flex flex-col gap-3 sm:max-w-md">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.email}
            <input type="email" name="email" required className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.role}
            <select name="role" defaultValue="admin" className={field}>
              <RoleOptions roles={roles} collaborator words={words} />
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.lasts}
            <input type="number" name="days" min={COLLABORATOR_DAYS.min} max={COLLABORATOR_DAYS.max} defaultValue={COLLABORATOR_DAYS.default} required className={`${field} w-28`} />
            <span className="text-xs font-normal text-muted">{fillWords(w.lastsHint, { max: COLLABORATOR_DAYS.max })}</span>
          </label>
          <div>
            <SubmitButton>{w.inviteCollaborator}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}

/** The store's requirement of two-step sign-in, with how many of the team have it. */
export function TwoStepRequirement({
  required,
  withIt,
  total,
  action,
  words,
}: {
  required: boolean;
  withIt: number;
  total: number;
  action: Action;
  /** The account's words (D312 A8); English unless given. */
  words?: StaffMessages;
}) {
  const w = (words ?? staffEn).twoStep;
  return (
    <Card title={w.title} compact>
      <p className="mb-3 text-sm text-muted">
        {countWords(total, w.count, { with: withIt })} {countWords(withIt, w.has)} {w.note}
      </p>
      <ActionForm action={action} className="flex flex-col gap-3">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="required" defaultChecked={required} className="mt-1 size-4" />
          <span>
            <span className="font-medium">{w.require}</span>
            <span className="block text-muted">
              {w.requireNote}
            </span>
          </span>
        </label>
        <div>
          <SubmitButton>{w.save}</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
