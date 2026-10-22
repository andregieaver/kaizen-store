import type { Metadata } from "next";
import Link from "next/link";

import { InviteForms, TeamList, TwoStepRequirement } from "@/components/admin/team-view";
import { requireOwnerRole } from "@/server/permissions";
import { listStaff } from "@/server/settings";
import { ensureStoreRoles, listStoreRoles } from "@/server/store-roles";
import { twoStepRequired } from "@/server/team";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

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
  const lang = adminLangOf(account.adminLocale);
  const words = adminText(lang, "staff");
  const w = words.team;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={w.title}
          description={w.description}
        />
        <div className="flex gap-2">
          <Link href={`/admin/${slug}/staff/roles`} className="inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-4 text-sm font-medium hover:bg-sunken">
            {w.roles}
          </Link>
          <Link href={`/admin/${slug}/activity`} className="inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-4 text-sm font-medium hover:bg-sunken">
            {w.activity}
          </Link>
        </div>
      </div>

      <section aria-labelledby="members-heading" className={`p-5 ${CARD_CLASS}`}>
        <h2 id="members-heading" className="sr-only">
          {w.members}
        </h2>
        <TeamList
          members={members}
          roles={roles}
          viewerId={account.id}
          now={new Date()}
          zone={store.timeZone || "Europe/Oslo"}
          words={words}
          locale={ADMIN_LANG_FACTS[lang].locale}
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
        words={words}
      />

      <InviteForms roles={roles} words={words} actions={{ staff: inviteStaffAction.bind(null, slug), collaborator: inviteCollaboratorAction.bind(null, slug) }} />
    </div>
  );
}
