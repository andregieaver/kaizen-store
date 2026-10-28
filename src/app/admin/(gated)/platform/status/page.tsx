import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import type { PlatformMessages } from "@/lib/admin-messages/platform.en";
import { platformText } from "@/lib/platform-text";
import { INCIDENT_IMPACTS, INCIDENT_STATUSES, STATUS_COMPONENTS } from "@/lib/status";
import { requirePlatformAdmin } from "@/server/auth";
import { readStatusOverview, subscriberCount, type IncidentView } from "@/server/status";

import { postIncidentAction, updateIncidentAction } from "./actions";

export const metadata: Metadata = { title: "Status page" };

const field = "flex flex-col gap-1 text-sm";
const control = "min-h-10 rounded-md border border-line bg-card px-3";

/** The status page's admin (D360): the latest checks, incidents to post and update, and how many subscribe. */
export default async function PlatformStatusPage() {
  await connection();
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "platform").status;
  const names = platformText("en").status.components;
  const [view, subscribers] = await Promise.all([readStatusOverview(), subscriberCount()]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={w.description}
        meta={[fillWords(w.subscribers, { n: subscribers })]}
        actions={
          <ButtonLink kind="secondary" href="/status">
            {w.open}
          </ButtonLink>
        }
      />
      <Card title={w.componentsTitle}>
        <ul className="flex flex-col gap-2 text-sm">
          {view.components.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <span className="text-body-strong text-ink">{names[c.id]}</span>
              <Chip signal={c.state === "ok" ? "positive" : c.state === "degraded" ? "danger" : "neutral"}>{w.state[c.state]}</Chip>
              {c.checkedAt && <span className="text-muted">{fillWords(w.checkedAt, { at: c.checkedAt.slice(0, 16).replace("T", " ") })}</span>}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={w.openTitle}>
        {view.open.length === 0 ? <p className="text-sm text-muted">{w.none}</p> : view.open.map((i) => <IncidentAdmin key={i.id} incident={i} w={w} names={names} />)}
      </Card>
      <Card title={w.postTitle}>
        <ActionForm action={postIncidentAction} className="flex flex-col gap-3" replaceOnSuccess>
          <label className={field}>
            {w.titleField}
            <input name="title" required maxLength={120} className={control} />
          </label>
          <label className={field}>
            {w.titleNb}
            <input name="titleNb" maxLength={120} className={control} />
          </label>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1">{w.impact}</legend>
            {INCIDENT_IMPACTS.map((impact, i) => (
              <label key={impact} className="flex items-center gap-2">
                <input type="radio" name="impact" value={impact} defaultChecked={i === 0} />
                {w.impacts[impact]}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1">{w.components}</legend>
            {STATUS_COMPONENTS.map((c) => (
              <label key={c} className="flex items-center gap-2">
                <input type="checkbox" name="components" value={c} />
                {names[c]}
              </label>
            ))}
          </fieldset>
          <label className={field}>
            {w.body}
            <textarea name="body" required maxLength={2000} rows={3} className={`${control} py-2`} />
          </label>
          <label className={field}>
            {w.bodyNb}
            <textarea name="bodyNb" maxLength={2000} rows={3} className={`${control} py-2`} />
          </label>
          <div>
            <SubmitButton>{w.post}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
      {view.recent.length > 0 && (
        <Card title={w.recentTitle}>
          <ul className="flex flex-col gap-1 text-sm">
            {view.recent.map((i) => (
              <li key={i.id}>
                {i.title} <span className="text-muted">· {w.impacts[i.impact]} · {i.startedAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type W = PlatformMessages["status"];

function IncidentAdmin({ incident, w, names }: { incident: IncidentView; w: W; names: Record<string, string> }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line py-3 last:border-0">
      <p className="text-body-strong text-ink">
        {incident.title} <span className="text-caption text-muted">· {w.impacts[incident.impact]} · {w.statuses[incident.status]}</span>
      </p>
      {incident.components.length > 0 && <p className="text-sm text-muted">{incident.components.map((c) => names[c]).join(", ")}</p>}
      <ol className="flex flex-col gap-1 text-sm">
        {incident.updates.map((u, n) => (
          <li key={n}>
            <span className="text-body-strong">{w.statuses[u.status]}</span> <span className="text-muted">{u.at.slice(0, 16).replace("T", " ")}</span> {u.body}
          </li>
        ))}
      </ol>
      <ActionForm action={updateIncidentAction.bind(null, incident.id)} className="flex flex-col gap-2" replaceOnSuccess>
        <p className="text-sm text-ink">{w.updateTitle}</p>
        <label className={field}>
          {w.status}
          <select name="status" defaultValue={incident.status} className={control}>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {w.statuses[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          {w.body}
          <textarea name="body" required maxLength={2000} rows={2} className={`${control} py-2`} />
        </label>
        <label className={field}>
          {w.bodyNb}
          <textarea name="bodyNb" maxLength={2000} rows={2} className={`${control} py-2`} />
        </label>
        <div>
          <SubmitButton variant="secondary">{w.update}</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
