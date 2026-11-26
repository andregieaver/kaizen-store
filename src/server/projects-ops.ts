import "server-only";

import type { ProjectsOp } from "@/lib/projects-ops";

import type { Membership } from "./auth";
import * as projects from "./projects";
import type { ProjectsResult } from "./projects-errors";
import * as items from "./projects-items";
import * as lists from "./projects-lists";
import * as statuses from "./projects-statuses";

/**
 * Runs one checked operation of a projects or checklists screen (D903) through the module that owns it. Each writer checks the member's
 * right again and names the store in every statement; this only routes.
 */
export async function runProjectsOp(member: Membership, op: ProjectsOp): Promise<ProjectsResult<{ id?: string; count?: number }>> {
  switch (op.op) {
    case "project.update":
      return projects.updateProject(member, op.id, op.patch);
    case "project.review":
      return projects.reviewProject(member, op.id);
    case "project.reorder":
      return projects.reorderProjects(member, op.ids);
    case "project.delete":
      return projects.deleteProject(member, op.id);
    case "project.link":
      return projects.linkChecklist(member, op.projectId, op.checklistId);
    case "project.unlink":
      return projects.unlinkChecklist(member, op.projectId, op.checklistId);
    case "project.reorderLists":
      return projects.reorderProjectChecklists(member, op.projectId, op.ids);
    case "project.stage":
      return projects.setItemStage(member, op.projectId, op.itemId, op.stageId);
    case "list.update":
      return lists.updateChecklist(member, op.id, op.patch);
    case "list.mode":
      return lists.setChecklistMode(member, op.id, { isAdvanced: op.isAdvanced, features: op.features, isRoutine: op.isRoutine, primaryProjectId: op.primaryProjectId });
    case "list.reset": {
      const result = await lists.resetChecklist(member, op.id);
      return result.ok ? { ok: true, count: result.reset } : result;
    }
    case "list.delete":
      return lists.deleteChecklist(member, op.id);
    case "list.reorder":
      return lists.reorderChecklists(member, op.ids);
    case "list.fold":
      return lists.setFold(member, op.id, op.sectionId, op.folded);
    case "item.add": {
      if (op.titles.length === 1) return items.addItem(member, op.checklistId, { title: op.titles[0] });
      const result = await items.addItems(member, op.checklistId, op.titles);
      return result.ok ? { ok: true, count: result.added } : result;
    }
    case "item.update":
      return items.updateItem(member, op.id, op.patch);
    case "item.done":
      return items.setItemDone(member, op.id, op.done);
    case "item.archive":
      return counted(await items.setItemArchived(member, op.ids, op.archived));
    case "item.delete":
      return counted(await items.deleteItems(member, op.ids));
    case "item.status":
      return counted(await items.setItemsStatus(member, op.ids, op.statusId));
    case "item.move":
      return counted(await items.moveItems(member, op.ids, op.checklistId));
    case "entries.reorder":
      return items.reorderEntries(member, op.checklistId, op.entries);
    case "section.add":
      return items.addSection(member, op.checklistId, op.title);
    case "section.rename":
      return items.renameSection(member, op.id, op.title);
    case "section.delete":
      return items.deleteSection(member, op.id);
    case "subtask.add":
      return items.addSubtask(member, op.itemId, { title: op.title });
    case "subtask.update":
      return items.updateSubtask(member, op.id, op.patch);
    case "subtask.reorder":
      return items.reorderSubtasks(member, op.itemId, op.ids);
    case "subtask.delete":
      return items.deleteSubtask(member, op.id);
    case "subtask.promote":
      return items.promoteSubtask(member, op.id);
    case "status.add":
      return statuses.addStatus(member, op.kind, op.scopeId, op.input);
    case "status.update":
      return statuses.updateStatus(member, op.kind, op.id, op.input);
    case "status.reorder":
      return statuses.reorderStatuses(member, op.kind, op.scopeId, op.ids);
    case "status.delete":
      return statuses.deleteStatus(member, op.kind, op.id, op.replacementId);
    case "status.useOwn":
      return statuses.useOwnStatuses(member, op.kind, op.scopeId);
    case "status.useStore":
      return statuses.useStoreStatuses(member, op.kind, op.scopeId);
  }
}

const counted = (result: ProjectsResult<{ changed: number }>): ProjectsResult<{ count: number }> => (result.ok ? { ok: true, count: result.changed } : result);
