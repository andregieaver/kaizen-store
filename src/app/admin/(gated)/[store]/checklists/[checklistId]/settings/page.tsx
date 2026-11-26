import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { requireFeature } from "@/components/admin/feature-off";
import { ListSettings } from "@/components/admin/projects/list-settings";
import { ChoiceField } from "@/components/admin/projects/parts";
import { StatusesEditor } from "@/components/admin/projects/statuses-editor";
import { Card, Field, PageHeader, TextInput } from "@/components/admin/ui";
import { TextArea } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { PROJECTS_WORDS } from "@/lib/admin-words/projects";
import { checklistFeatures } from "@/lib/projects-features";
import { CHECKLIST_STATES, PROJECT_LIMITS } from "@/lib/projects-model";
import { whenFields } from "@/lib/projects-dates";
import { memberCan, requirePermission } from "@/server/permissions";
import { projectChoices, teamOf } from "@/server/projects";
import { checklistDetail } from "@/server/projects-lists";

import { projectsAction, saveChecklistAction } from "../../../projects/actions";

export const metadata: Metadata = { title: "Customise checklist" };

/**
 * A checklist's settings (D903, Life's `app/app/checklists/[id]/settings`): its details (title, notes, due date, who it is for, its goal on
 * an advanced list, its state), how it works (Advanced list and its fields, Routine), its projects and home, and its statuses.
 */
export default async function ChecklistSettingsPage({ params }: PageProps<"/admin/[store]/checklists/[checklistId]/settings">) {
  const { store: slug, checklistId } = await params;
  const member = await requirePermission(slug, "projects:read");
  const off = requireFeature(member, "projects");
  if (off) return off;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = PROJECTS_WORDS[lang];
  const [list, projects, team] = await Promise.all([checklistDetail(store.id, checklistId, member.account.id), projectChoices(store.id), teamOf(store.id)]);
  if (!list) notFound();
  const canChange = memberCan(member, "projects:write");
  const act = projectsAction.bind(null, store.slug);
  const s = w.listSettings;
  const stored = checklistFeatures({ isAdvanced: true, advancedFeatures: list.advancedFeatures });
  const due = whenFields(list.dueAt, true, store.timeZone);
  const inList = new Set(list.projects.map((p) => p.id));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/checklists/${list.id}`, label: list.title }} title={fillWords(s.title, { title: list.title })} />
      <Card title={s.details}>
        <ActionForm action={saveChecklistAction.bind(null, store.slug, list.id)} className="flex flex-col gap-4">
          <Field label={w.checklists.titleField} required>
            {(control) => <TextInput {...control} name="title" defaultValue={list.title} maxLength={PROJECT_LIMITS.checklistTitle} disabled={!canChange} full />}
          </Field>
          <Field label={s.description}>
            {(control) => <TextArea {...control} name="description" defaultValue={list.description ?? ""} rows={3} maxLength={PROJECT_LIMITS.description} disabled={!canChange} full />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={w.item.dueAt}>{(control) => <TextInput {...control} type="date" name="dueAt" defaultValue={due.day} disabled={!canChange} full />}</Field>
            <ChoiceField label={s.assignee} name="assignedTo" value={list.assignedTo ?? ""} options={[{ value: "", label: w.nobody }, ...team.map((p) => ({ value: p.id, label: p.name }))]} disabled={!canChange} />
            <ChoiceField label={s.state} name="status" value={list.status} options={CHECKLIST_STATES.map((v) => ({ value: v, label: w.checklistStates[v] }))} disabled={!canChange} />
          </div>
          {list.features.goal && (
            <Field label={s.goal} hint={s.goalHint}>
              {(control) => <TextArea {...control} name="goal" defaultValue={list.goal ?? ""} rows={2} maxLength={PROJECT_LIMITS.goal} disabled={!canChange} full />}
            </Field>
          )}
          {canChange && <SubmitButton>{w.save}</SubmitButton>}
        </ActionForm>
      </Card>
      <Card>
        <ListSettings
          listId={list.id}
          mode={{ isAdvanced: list.isAdvanced, isRoutine: list.isRoutine, features: list.features }}
          stored={stored}
          projects={list.projects}
          homeId={list.primaryProjectId}
          addable={projects.filter((p) => !inList.has(p.id) && p.status !== "archived").map((p) => ({ id: p.id, name: p.name }))}
          ownStatuses={list.ownStatuses}
          canChange={canChange}
          words={w}
          act={act}
        />
      </Card>
      {list.ownStatuses && (
        <Card title={s.statuses}>
          <StatusesEditor kind="checklist" scopeId={list.id} statuses={list.statuses.map((x) => ({ id: x.id, name: x.name, colour: x.colour, bucket: x.bucket }))} canChange={canChange} words={w} act={act} />
        </Card>
      )}
    </div>
  );
}
