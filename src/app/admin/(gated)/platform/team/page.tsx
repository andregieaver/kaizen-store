import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { PLATFORM_ROLES } from "@/lib/platform-access";
import { requirePlatformReader } from "@/server/auth";
import { listPlatformAdmins } from "@/server/platform-team";

import { addAdminAction, removeAdminAction, setRoleAction } from "./actions";

export const metadata: Metadata = { title: "Team" };

/**
 * The platform's team (C1 of `docs/platform-parity-plan.md`, D471, D510): who runs Kaizena Flow, in which role, whether each has two-step
 * sign-in, and adding, changing or removing one (an owner's work; the others see the list). An owner is also an owner of Kaizena Flow's own
 * store, by the database (D466); the other roles work in it as admins in the same role.
 */
export default async function PlatformTeamPage() {
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const w = adminText(lang, "console").team;
  const people = await listPlatformAdmins(admin);
  // Only an owner changes the team (D510); the others see who is on it.
  const owner = admin.platformAdmin;
  const select = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";
  const date = (iso: string) => new Date(iso).toLocaleDateString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.title} description={w.description} />

      <Card title={w.members} description={w.membersText}>
        <ul className="flex flex-col divide-y divide-line">
          {people.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="flex min-w-0 flex-col">
                <span className="text-body text-ink [overflow-wrap:anywhere]">
                  {p.name || p.email}
                  {p.you && <span className="text-muted"> · {w.you}</span>}
                </span>
                <span className="text-sm text-ink-2">{w.roleHelp[p.role]}</span>
                <span className="text-sm text-muted [overflow-wrap:anywhere]">
                  {p.name ? `${p.email} · ` : ""}
                  {p.twoStep ? w.twoStepOn : w.twoStepOff} · {fillWords(w.since, { date: date(p.since) })}
                </span>
              </span>
              {owner && !p.you ? (
                <span className="flex flex-wrap items-center gap-2">
                  <ActionForm action={setRoleAction.bind(null, p.id)} className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`role-${p.id}`}>
                      {w.role}
                    </label>
                    <select id={`role-${p.id}`} name="role" defaultValue={p.role} className={select}>
                      {PLATFORM_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {w.roles[r]}
                        </option>
                      ))}
                    </select>
                    <SubmitButton variant="secondary">{w.change}</SubmitButton>
                  </ActionForm>
                  <ActionForm action={removeAdminAction.bind(null, p.id)}>
                    <SubmitButton variant="secondary">{w.remove}</SubmitButton>
                  </ActionForm>
                </span>
              ) : (
                <span className="text-sm text-ink-2">{w.roles[p.role]}</span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {owner && (
      <Card title={w.addTitle} description={w.addText}>
        <ActionForm action={addAdminAction} className="flex flex-col gap-4">
          <label className="flex max-w-md flex-col gap-1 text-sm">
            {w.email}
            <input name="email" type="email" required autoComplete="off" className="min-h-10 rounded-md border border-line bg-card px-3 font-normal" />
          </label>
          <label className="flex max-w-md flex-col gap-1 text-sm">
            {w.name}
            <input name="name" type="text" autoComplete="off" className="min-h-10 rounded-md border border-line bg-card px-3 font-normal" />
          </label>
          <fieldset className="flex max-w-xl flex-col gap-2 text-sm">
            <legend className="mb-1">{w.role}</legend>
            {PLATFORM_ROLES.map((r) => (
              <label key={r} className="flex items-start gap-2">
                <input type="radio" name="role" value={r} defaultChecked={r === "read_only"} className="mt-1" />
                <span>
                  <span className="text-ink">{w.roles[r]}</span>
                  <span className="text-muted"> · {w.roleHelp[r]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div>
            <SubmitButton>{w.add}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
      )}
    </div>
  );
}
