import type { Metadata } from "next";
import Link from "next/link";

import { InviteForms, TeamList, TwoStepRequirement } from "@/components/admin/team-view";
import { requireOwnerRole } from "@/server/permissions";
import { listStaff } from "@/server/settings";
import { ensureStoreRoles, listStoreRoles } from "@/server/store-roles";
import { twoStepRequired } from "@/server/team";

import {
  assignRoleAction,
  disableStaffAction,
  extendCollaboratorAction,
  inviteCollaboratorAction,
  inviteStaffAction,
  setTwoStepRequirementAction,
} from "./actions";

export const metadata: Metadata = { title: "Team" };

/**
 * The store's team (wave 1, 1f): who works in the store and with what role, collaborators with an end date, who has two-step sign-in and
 * whether the store requires it. The owner's page: the team and the plan are held by owners only, so a role can never grant them.
 */
export default async function StaffPage({ params }: PageProps<"/admin/[store]/staff">) {
  const { account, store } = await requireOwnerRole((await params).store);
  // The six starting roles are made the first time the team is looked at, and never again once an owner has deleted one.
  await ensureStoreRoles(store.id, account.id);
  const [members, roles, required] = await Promise.all([listStaff(store.id), listStoreRoles(store.id), twoStepRequired(store.id)]);
  const active = members.filter((m) => !m.disabled);
  const slug = store.slug;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Team</h1>
          <p className="max-w-2xl text-sm text-muted">
            People listed here can sign in with a link sent to their email, or with their password. Owners manage the team and the plan; everyone else
            works in the parts of the admin their role gives them.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/admin/${slug}/staff/roles`} className="inline-flex min-h-10 items-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-surface">
            Roles
          </Link>
          <Link href={`/admin/${slug}/activity`} className="inline-flex min-h-10 items-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-surface">
            Activity log
          </Link>
        </div>
      </div>

      <section aria-labelledby="members-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="members-heading" className="sr-only">
          Members
        </h2>
        <TeamList
          members={members}
          roles={roles}
          viewerId={account.id}
          now={new Date()}
          zone={store.timeZone || "Europe/Oslo"}
          actions={{
            assign: assignRoleAction.bind(null, slug),
            extend: extendCollaboratorAction.bind(null, slug),
            disable: disableStaffAction.bind(null, slug),
          }}
        />
      </section>

      <TwoStepRequirement
        required={required}
        withIt={active.filter((m) => m.hasTwoStep).length}
        total={active.length}
        action={setTwoStepRequirementAction.bind(null, slug)}
      />

      <InviteForms roles={roles} actions={{ staff: inviteStaffAction.bind(null, slug), collaborator: inviteCollaboratorAction.bind(null, slug) }} />
    </div>
  );
}
