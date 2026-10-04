/**
 * What the Team and Roles pages send (wave 1, 1f, `docs/wave-1-trust.md` 2.7): the area-by-level choices of the role editor, and the
 * select that gives a member a role. Pure, so the browser's form and the server's reading of it are one function, and a test holds both.
 * The server still checks every key against what a custom role may hold (`roleProblems()`): nothing here is trusted.
 */
import { AREAS, WORKING_AREAS, permissionsFromLevels, type Area, type AreaLevel, type AreaPermission } from "./permissions";

/** The form field of an area's level in the role editor. */
export const levelField = (area: Area): string => `level:${area}`;

export const LEVELS: readonly { level: AreaLevel; label: string }[] = [
  { level: "none", label: "No access" },
  { level: "read", label: "Can view" },
  { level: "write", label: "Can change" },
];

const isLevel = (value: unknown): value is AreaLevel => value === "none" || value === "read" || value === "write";

/** The levels a role editor's form chose, for the working areas only: Team and Billing are held by owners and cannot be given in a role. */
export function levelsFromForm(get: (name: string) => unknown): Partial<Record<Area, AreaLevel>> {
  const levels: Partial<Record<Area, AreaLevel>> = {};
  for (const area of WORKING_AREAS) {
    const value = get(levelField(area));
    levels[area] = isLevel(value) ? value : "none";
  }
  return levels;
}

/** A role from the form: its name as typed and its keys, normalised and without anything an owner alone holds. */
export function roleFromForm(get: (name: string) => unknown): { name: string; permissions: AreaPermission[] } {
  const name = typeof get("name") === "string" ? String(get("name")) : "";
  return { name, permissions: permissionsFromLevels(levelsFromForm(get)) };
}

/** What a member can be given in the select: the owner role, the default admin set, or one of the store's roles. */
export type RoleChoiceValue = { kind: "owner" } | { kind: "admin" } | { kind: "role"; roleId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const roleChoiceValue = (choice: RoleChoiceValue): string => (choice.kind === "role" ? `role:${choice.roleId}` : choice.kind);

/** The select's value read back; null for anything else. */
export function parseRoleChoice(value: unknown): RoleChoiceValue | null {
  if (value === "owner") return { kind: "owner" };
  if (value === "admin") return { kind: "admin" };
  if (typeof value === "string" && value.startsWith("role:")) {
    const roleId = value.slice(5);
    return UUID.test(roleId) ? { kind: "role", roleId: roleId.toLowerCase() } : null;
  }
  return null;
}

/** A sentence on what a role holds, for the roles list: "Can change orders; can view customers and products." */
export function roleSummary(permissions: readonly string[]): string {
  const change: string[] = [];
  const view: string[] = [];
  for (const area of AREAS) {
    if (permissions.includes(`${area}:write`)) change.push(area);
    else if (permissions.includes(`${area}:read`)) view.push(area);
  }
  const join = (list: string[]) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
  const parts: string[] = [];
  if (change.length > 0) parts.push(`Can change ${join(change)}`);
  if (view.length > 0) parts.push(`${parts.length > 0 ? "can" : "Can"} view ${join(view)}`);
  return parts.length > 0 ? `${parts.join("; ")}.` : "No access to anything yet.";
}
