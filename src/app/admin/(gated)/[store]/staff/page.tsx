import type { Metadata } from "next";
import Link from "next/link";

import { InviteForms, TeamList, TwoStepRequirement } from "@/components/admin/team-view";
import { requireOwnerRole } from "@/server/permissions";
import { listStaff } from "@/server/settings";
import { ensureStoreRoles, listStoreRoles } from "@/server/store-roles";
import { twoStepRequired } from "@/server/team";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { zoneOf } from "@/lib/admin-date";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { MoreMenu } from "@/components/admin/orders/order-folds";

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
  const withTwoStep = active.filter((m) => m.hasTwoStep).length;
  const slug = store.slug;
  const lang = adminLangOf(account.adminLocale);
  const words = adminText(lang, "staff");
  const w = words.team;

  return (
    <div className="flex flex-col gap-8">
      {/* Round 8 (D626): who works here in a sentence; Roles and the activity log under More; Invite is the one button. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title={w.title}
          meta={[
            <span key="people">
              <span className="text-ink">{countWords(active.length, w.sentence.people, { store: store.name })}</span>
              {withTwoStep === 0 ? w.sentence.none : withTwoStep === active.length ? w.sentence.all : fillWords(w.sentence.some, { with: withTwoStep, n: active.length })}
            </span>,
          ]}
        />
        <div className="flex gap-2">
          <MoreMenu label={w.more}>
            <Link href={`/admin/${slug}/staff/roles`} className="inline-flex min-h-10 items-center rounded-pill px-4 text-sm hover:bg-sunken">
              {w.roles}
            </Link>
            <Link href={`/admin/${slug}/activity`} className="inline-flex min-h-10 items-center rounded-pill px-4 text-sm hover:bg-sunken">
              {w.activity}
            </Link>
          </MoreMenu>
          {!store.house && (
            <a href="#invite" className="inline-flex h-11 items-center rounded-pill bg-brand px-5 text-body-strong text-brand-ink hover:bg-brand-hover">
              {w.inviteButton}
            </a>
          )}
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
          zone={zoneOf(store)}
          words={words}
          locale={ADMIN_LANG_FACTS[lang].locale}
          actions={{
            assign: assignRoleAction.bind(null, slug),
            extend: extendCollaboratorAction.bind(null, slug),
            disable: disableStaffAction.bind(null, slug),
          }}
        />
      </section>


      {/* Kaizena Flow's own store (D466): its team is the platform admins, kept in step by the database; nobody is invited here. */}
      {store.house ? (
        <section aria-labelledby="house-team-heading" className={`p-5 ${CARD_CLASS}`}>
          <h2 id="house-team-heading" className="text-title text-ink">
            {w.houseTitle}
          </h2>
          <p className="mt-1 text-sm text-muted">{w.houseText}</p>
        </section>
      ) : (
        <InviteForms roles={roles} words={words} actions={{ staff: inviteStaffAction.bind(null, slug), collaborator: inviteCollaboratorAction.bind(null, slug) }} />
      )}

      <TwoStepRequirement
        required={required}
        withIt={withTwoStep}
        total={active.length}
        action={setTwoStepRequirementAction.bind(null, slug)}
        words={words}
      />
    </div>
  );
}
