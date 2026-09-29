"use server";

import { refresh } from "next/cache";

import type { assignmentInput, clientInput, taskInput, timeEntryInput, timeEntryNoteInput } from "@/lib/work-input";
import { requireMember, type Membership } from "@/server/auth";
import {
  createAssignment,
  createClient,
  createTask,
  deleteAssignment,
  deleteClient,
  deleteTask,
  reorderTasks,
  renameTask,
  setAssignmentStatus,
  setClientArchived,
  setTaskEstimate,
  setTaskStatus,
  updateAssignment,
  updateClient,
} from "@/server/work";
import { problem, type WorkResult } from "@/server/work-errors";
import {
  deleteTimeEntry,
  discardTimer,
  getRunningTimer,
  logTime,
  setEntryNote,
  startTimer,
  stopTimer,
  updateTimeEntry,
  type RunningTimer,
  type StoppedEntry,
} from "@/server/work-time";
import type { z } from "zod";

/**
 * Work's actions for clients, assignments, tasks, time and timers (docs/work.md
 * 7.2 WP3). Each is bound to the store's slug as its first argument and asks
 * `requireMember()` itself (a layout's check does not stop a page or an action
 * running), then hands what the browser sent to the server function, which
 * checks it again with the shared schemas. They answer `{ ok: true }` (with
 * what was made) or `{ ok: false, problems }`, and refresh what is on screen.
 * Invoices and settings have their own action files.
 *
 * Nothing here is cached (Work's pages read per request), so there is no tag
 * to update; `refresh()` re-reads the page the person is on. The events go to
 * `work_events` from the server functions, and deleting a client is audited
 * there too.
 */

const OFF = "Work is switched off for this store.";

/** The membership, for a store that has Work switched on (data is kept when it is off, but nothing changes). */
async function workMember(storeSlug: string): Promise<Membership | null> {
  const member = await requireMember(storeSlug);
  return member.store.workOn ? member : null;
}

/** Runs a change for a member of a store with Work on, and refreshes the page when it worked. */
async function change<T extends object>(
  storeSlug: string,
  run: (member: Membership) => Promise<WorkResult<T>>,
): Promise<WorkResult<T>> {
  const member = await workMember(storeSlug);
  if (!member) return problem(OFF);
  const result = await run(member);
  if (result.ok) refresh();
  return result;
}

// --- Clients -----------------------------------------------------------------------

export async function createClientAction(storeSlug: string, input: z.input<typeof clientInput>) {
  return change(storeSlug, (member) => createClient(member, input));
}

export async function updateClientAction(storeSlug: string, clientId: string, input: z.input<typeof clientInput>) {
  return change(storeSlug, (member) => updateClient(member, clientId, input));
}

/** Archives a client (or brings it back). Any member. */
export async function archiveClientAction(storeSlug: string, clientId: string, archived: boolean) {
  return change(storeSlug, (member) => setClientArchived(member, clientId, archived));
}

/** Deletes a client that has no history. Owners only, and audited. */
export async function deleteClientAction(storeSlug: string, clientId: string) {
  return change(storeSlug, (member) => deleteClient(member, clientId));
}

// --- Assignments --------------------------------------------------------------------

export async function createAssignmentAction(storeSlug: string, input: z.input<typeof assignmentInput>) {
  return change(storeSlug, (member) => createAssignment(member, input));
}

export async function updateAssignmentAction(
  storeSlug: string,
  assignmentId: string,
  input: z.input<typeof assignmentInput>,
) {
  return change(storeSlug, (member) => updateAssignment(member, assignmentId, input));
}

export async function setAssignmentStatusAction(
  storeSlug: string,
  assignmentId: string,
  status: "active" | "paused" | "done",
) {
  return change(storeSlug, (member) => setAssignmentStatus(member, assignmentId, status));
}

export async function deleteAssignmentAction(storeSlug: string, assignmentId: string) {
  return change(storeSlug, (member) => deleteAssignment(member, assignmentId));
}

// --- Tasks -----------------------------------------------------------------------------

export async function createTaskAction(storeSlug: string, input: z.input<typeof taskInput>) {
  return change(storeSlug, (member) => createTask(member, input));
}

export async function renameTaskAction(storeSlug: string, taskId: string, title: string) {
  return change(storeSlug, (member) => renameTask(member, taskId, title));
}

export async function setTaskStatusAction(storeSlug: string, taskId: string, status: "open" | "done") {
  return change(storeSlug, (member) => setTaskStatus(member, taskId, status));
}

/** Sets a task's estimate in minutes; null takes it away. */
export async function setTaskEstimateAction(storeSlug: string, taskId: string, minutes: number | null) {
  return change(storeSlug, (member) => setTaskEstimate(member, taskId, minutes));
}

export async function reorderTasksAction(storeSlug: string, assignmentId: string, orderedIds: string[]) {
  return change(storeSlug, (member) => reorderTasks(member, assignmentId, orderedIds));
}

export async function deleteTaskAction(storeSlug: string, taskId: string) {
  return change(storeSlug, (member) => deleteTask(member, taskId));
}

// --- Time entries -----------------------------------------------------------------------

/** Logs time for the signed-in member. The minutes come from `parseDuration()` in the browser and are checked again. */
export async function logTimeAction(storeSlug: string, input: z.input<typeof timeEntryInput>) {
  return change(storeSlug, (member) => logTime(member, input));
}

/** Changes an entry. Owners any entry, admins their own. */
export async function updateTimeEntryAction(storeSlug: string, entryId: string, input: z.input<typeof timeEntryInput>) {
  return change(storeSlug, (member) => updateTimeEntry(member, entryId, input));
}

export async function setEntryNoteAction(
  storeSlug: string,
  entryId: string,
  input: z.input<typeof timeEntryNoteInput>,
) {
  return change(storeSlug, (member) => setEntryNote(member, entryId, input));
}

/** Deletes an entry that is not on an invoice. Owners any entry, admins their own. */
export async function deleteTimeEntryAction(storeSlug: string, entryId: string) {
  return change(storeSlug, (member) => deleteTimeEntry(member, entryId));
}

// --- Timers ------------------------------------------------------------------------------

/** Starts the member's timer, stopping and logging the one that was running. */
export async function startTimerAction(
  storeSlug: string,
  assignmentId: string,
  taskId: string | null = null,
): Promise<WorkResult<{ startedAt: string; stopped: StoppedEntry | null }>> {
  return change(storeSlug, (member) => startTimer(member, { assignmentId, taskId }));
}

/** Stops the member's timer (`forAccountId`: someone else's, owners only). Nothing running answers `entry: null`. */
export async function stopTimerAction(
  storeSlug: string,
  options: { note?: string | null; forAccountId?: string } = {},
): Promise<WorkResult<{ entry: StoppedEntry | null; capped: boolean }>> {
  return change(storeSlug, (member) => stopTimer(member, options));
}

/** Throws away the member's own running timer without logging it. Nothing running answers `discarded: false`. */
export async function discardTimerAction(storeSlug: string): Promise<WorkResult<{ discarded: boolean }>> {
  return change(storeSlug, (member) => discardTimer(member));
}

/** The signed-in member's running timer, for a page that wants to look again (a read: nothing is refreshed). */
export async function runningTimerAction(storeSlug: string): Promise<RunningTimer | null> {
  const member = await workMember(storeSlug);
  return member ? getRunningTimer(member.store.id, member.account.id) : null;
}
