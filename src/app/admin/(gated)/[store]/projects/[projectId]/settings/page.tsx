import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { requireFeature } from "@/components/admin/feature-off";
import { ActButton } from "@/components/admin/projects/act-button";
import { ChoiceField } from "@/components/admin/projects/parts";
import { StatusesEditor } from "@/components/admin/projects/statuses-editor";
import { Card, Field, PageHeader, TextInput } from "@/components/admin/ui";
import { TextArea } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { PROJECTS_WORDS } from "@/lib/admin-words/projects";
import { PROJECT_COLOURS, PROJECT_HEALTHS, PROJECT_LIMITS, PROJECT_STATUSES } from "@/lib/projects-model";
import { memberCan, requirePermission } from "@/server/permissions";
import { projectDetail } from "@/server/projects";
import { allStatuses } from "@/server/projects-statuses";

import { projectsAction, saveProjectAction } from "../../actions";

export const metadata: Metadata = { title: "Customise project" };

/**
 * A project's settings (D903): its details (name, description, colour, status and health, next action, target date), that its status still
 * stands, its stages (the store's until it has its own: Lisa's step), and deleting it, which leaves its checklists as they are.
 */
export default async function ProjectSettingsPage({ params }: PageProps<"/admin/[store]/projects/[projectId]/settings">) {
  const { store: slug, projectId } = await params;
  const member = await requirePermission(slug, "projects:read");
  const off = requireFeature(member, "projects");
  if (off) return off;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = PROJECTS_WORDS[lang];
  const [project, stages] = await Promise.all([projectDetail(store.id, projectId), allStatuses(store.id, "project")]);
  if (!project) notFound();
  const canChange = memberCan(member, "projects:write");
  const act = projectsAction.bind(null, store.slug);
  const own = stages.some((s) => s.scopeId === project.id);
  const base = `/admin/${store.slug}/projects`;
  const s = w.projectSettings;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `${base}/${project.id}`, label: project.name }} title={fillWords(s.title, { name: project.name })} />
      <Card title={s.details}>
        <ActionForm action={saveProjectAction.bind(null, store.slug, project.id)} className="flex flex-col gap-4">
          <Field label={w.projects.name} required>
            {(control) => <TextInput {...control} name="name" defaultValue={project.name} maxLength={PROJECT_LIMITS.projectName} disabled={!canChange} full />}
          </Field>
          <Field label={s.description}>
            {(control) => <TextArea {...control} name="description" defaultValue={project.description ?? ""} rows={3} maxLength={PROJECT_LIMITS.description} disabled={!canChange} full />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <ChoiceField label={s.status} name="status" value={project.status} options={PROJECT_STATUSES.map((v) => ({ value: v, label: w.projectStatuses[v] }))} disabled={!canChange} />
            <ChoiceField label={s.health} name="health" value={project.health} options={PROJECT_HEALTHS.map((v) => ({ value: v, label: w.health[v] }))} disabled={!canChange} />
            <Field label={w.projects.targetDate}>{(control) => <TextInput {...control} type="date" name="targetDate" defaultValue={project.targetDate ?? ""} disabled={!canChange} full />}</Field>
            <ChoiceField label={s.colour} name="colour" value={project.colour} options={PROJECT_COLOURS.map((v) => ({ value: v, label: w.colours[v] }))} disabled={!canChange} />
          </div>
          <Field label={s.nextAction} hint={s.nextActionHint}>
            {(control) => <TextInput {...control} name="nextAction" defaultValue={project.nextAction ?? ""} maxLength={PROJECT_LIMITS.nextAction} disabled={!canChange} full />}
          </Field>
          {canChange && (
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>{w.save}</SubmitButton>
              <ActButton op={{ op: "project.review", id: project.id }} act={act} label={s.review} kind="quiet" done={{ one: s.reviewDone, many: s.reviewDone }} />
            </div>
          )}
        </ActionForm>
      </Card>
      <Card title={s.stages} description={s.stagesText}>
        <div className="flex flex-col gap-4">
          {own ? (
            <StatusesEditor
              kind="project"
              scopeId={project.id}
              statuses={project.stages.map((x) => ({ id: x.id, name: x.name, colour: x.colour, bucket: x.bucket }))}
              canChange={canChange}
              words={w}
              act={act}
            />
          ) : (
            <ul className="flex flex-wrap gap-2">
              {project.stages.map((x) => (
                <li key={x.id} className="rounded-pill bg-sunken px-3 py-1 text-chip text-ink-2">
                  {x.name}
                </li>
              ))}
            </ul>
          )}
          {canChange &&
            (own ? (
              <ActButton
                op={{ op: "status.useStore", kind: "project", scopeId: project.id }}
                act={act}
                label={w.listSettings.useStore}
                kind="quiet"
                ask={{ question: w.listSettings.useStoreConfirm, confirm: w.listSettings.useStore, danger: false }}
              />
            ) : (
              <ActButton op={{ op: "status.useOwn", kind: "project", scopeId: project.id }} act={act} label={w.listSettings.useOwn} />
            ))}
        </div>
      </Card>
      {canChange && (
        <div>
          <ActButton
            op={{ op: "project.delete", id: project.id }}
            act={act}
            label={s.deleteProject}
            kind="danger"
            after={base}
            ask={{ question: fillWords(s.deleteConfirm, { name: project.name }), confirm: w.delete }}
          />
        </div>
      )}
    </div>
  );
}
