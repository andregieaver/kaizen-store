import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePlatformAdmin } from "@/server/auth";
import { listPlatformAdmins } from "@/server/platform-team";

import { addAdminAction, removeAdminAction } from "./actions";

export const metadata: Metadata = { title: "Team" };

/**
 * The platform's team (C1 of `docs/platform-parity-plan.md`, D471): who runs Kaizena Flow, whether each has two-step sign-in, and adding or
 * removing one. Each is also an owner of Kaizena Flow's own store, by the database (D466).
 */
export default async function PlatformTeamPage() {
  await connection();
  const admin = await requirePlatformAdmin();
  const lang = adminLangOf(admin.adminLocale);
  const w = adminText(lang, "console").team;
  const people = await listPlatformAdmins(admin);
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
                <span className="text-sm text-muted [overflow-wrap:anywhere]">
                  {p.name ? `${p.email} · ` : ""}
                  {p.twoStep ? w.twoStepOn : w.twoStepOff} · {fillWords(w.since, { date: date(p.since) })}
                </span>
              </span>
              {!p.you && people.length > 1 && (
                <ActionForm action={removeAdminAction.bind(null, p.id)}>
                  <SubmitButton variant="secondary">{w.remove}</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      </Card>

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
          <div>
            <SubmitButton>{w.add}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
