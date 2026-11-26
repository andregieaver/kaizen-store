import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { StatusesEditor } from "@/components/admin/projects/statuses-editor";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { PROJECTS_WORDS } from "@/lib/admin-words/projects";
import { memberCan, requirePermission } from "@/server/permissions";
import { ensureDefaultStatuses, statusesOf } from "@/server/projects-statuses";

import { projectsAction } from "../actions";

export const metadata: Metadata = { title: "Statuses" };

/**
 * The store's statuses (D903, Life's checklist and task default statuses): what a task is (its statuses) and where it stands in a project
 * (the stages). Every list and project uses these until it has its own; Lisa's page, one step from Projects.
 */
export default async function StatusesPage({ params }: PageProps<"/admin/[store]/projects/statuses">) {
  const member = await requirePermission((await params).store, "projects:read");
  const off = requireFeature(member, "projects");
  if (off) return off;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = PROJECTS_WORDS[lang];
  await ensureDefaultStatuses(store.id, w.defaults);
  const [items, stages] = await Promise.all([statusesOf(store.id, "checklist", null), statusesOf(store.id, "project", null)]);
  const canChange = memberCan(member, "projects:write");
  const act = projectsAction.bind(null, store.slug);
  const shape = (list: typeof items) => list.map((s) => ({ id: s.id, name: s.name, colour: s.colour, bucket: s.bucket }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/projects`, label: w.project.back }} title={w.statuses.title} description={w.statuses.description} />
      <Card title={w.statuses.items} description={w.statuses.itemsText}>
        <StatusesEditor kind="checklist" scopeId={null} statuses={shape(items)} canChange={canChange} words={w} act={act} />
      </Card>
      <Card title={w.statuses.stages} description={w.statuses.stagesText}>
        <StatusesEditor kind="project" scopeId={null} statuses={shape(stages)} canChange={canChange} words={w} act={act} />
      </Card>
    </div>
  );
}
