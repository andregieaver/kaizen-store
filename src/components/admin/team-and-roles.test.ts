import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { ROLE_TEMPLATES } from "@/lib/permissions";
import type { StaffMember } from "@/server/settings";

import { RoleEditor } from "./role-editor";
import { InviteForms, RoleOptions, TeamList, TwoStepRequirement, roleLabel } from "./team-view";

const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/ /g, " ");

const action = async () => ({ status: "ok" as const, messages: [] });

describe("the role editor", () => {
  const editor = (role?: { name: string; permissions: readonly string[] }) => html(createElement(RoleEditor, { action, role, submitLabel: "Save role", idPrefix: "r" }));

  it("has a name and one choice of no access, can view or can change for each working area", () => {
    const out = editor();
    for (const area of ["Orders", "Products", "Customers", "Marketing", "Analytics", "Website", "Bookings", "Settings"]) {
      for (const level of ["no access", "can view", "can change"]) expect(out).toContain(`aria-label="${area}: ${level}"`);
    }
    expect(out).toContain('name="name"');
    expect(out).toContain('name="level:orders"');
  });

  it("shows Team and Billing as the owner's alone, with nothing to choose", () => {
    const out = editor();
    expect(out.match(/Owners only: a role cannot give this/g)).toHaveLength(2);
    expect(out).not.toContain('name="level:staff"');
    expect(out).not.toContain('name="level:billing"');
  });

  it("starts a new role with no access anywhere, and a template with its own levels", () => {
    const fresh = editor();
    expect(fresh.match(/checked="" value="none"/g)).toHaveLength(8);
    const orders = editor({ name: ROLE_TEMPLATES.orders.name, permissions: ROLE_TEMPLATES.orders.permissions });
    expect(orders).toContain('value="Orders"');
    expect(orders).toMatch(/name="level:orders" checked="" value="write"/);
    expect(orders).toMatch(/name="level:customers" checked="" value="read"/);
    expect(orders).toMatch(/name="level:marketing" checked="" value="none"/);
  });
});

describe("the team", () => {
  const member = (over: Partial<StaffMember>): StaffMember => ({
    accountId: "00000000-0000-4000-8000-000000000001",
    email: "anna@example.no",
    name: null,
    avatarPath: null,
    role: "admin",
    signedInBefore: true,
    disabled: false,
    roleId: null,
    roleName: null,
    kind: "staff",
    expiresAt: null,
    hasTwoStep: false,
    ...over,
  });
  const roles = [{ id: "6f1c0b9e-1111-4222-8333-444455556666", name: "Orders" }];
  const list = (members: StaffMember[], now = new Date("2026-10-03T12:00:00Z")) =>
    html(createElement(TeamList, { members, roles, viewerId: "me", now, zone: "Europe/Oslo", actions: { assign: action, extend: action, disable: action } }));

  it("says each member's role: owner, a custom role's name, or admin", () => {
    expect(roleLabel({ role: "owner", roleName: null })).toBe("Owner");
    expect(roleLabel({ role: "admin", roleName: "Orders" })).toBe("Orders");
    expect(roleLabel({ role: "admin", roleName: null })).toBe("Admin");
  });

  it("badges a collaborator with the end date, and says who has two-step sign-in", () => {
    const out = list([member({ kind: "collaborator", expiresAt: "2026-11-02T10:00:00Z", hasTwoStep: true })]);
    expect(out).toContain("Collaborator until 2 Nov 2026");
    expect(out).toContain("Two-step on");
    expect(list([member({})])).toContain("No two-step");
  });

  it("offers the owner role to staff but never to a collaborator", () => {
    const staff = list([member({})]);
    const collaborator = list([member({ kind: "collaborator", expiresAt: "2026-11-02T10:00:00Z" })]);
    expect(staff).toContain('<option value="owner"');
    expect(collaborator).not.toContain('<option value="owner"');
    expect(collaborator).toContain("Days from today");
    expect(staff).not.toContain("Days from today");
  });

  it("gives the member's current role as the selection, and the store's roles as choices", () => {
    const out = list([member({ roleId: roles[0].id, roleName: "Orders" })]);
    expect(out).toContain(`value="role:${roles[0].id}" selected=""`);
  });

  it("does not offer to remove yourself", () => {
    const out = list([member({ accountId: "me", email: "me@example.no" })]);
    expect(out).not.toContain("Remove access");
    expect(list([member({})])).toContain("Remove access");
  });

  it("lists those whose access has ended apart, and not as members", () => {
    const out = list([
      member({ accountId: "a", email: "gone@example.no", kind: "collaborator", expiresAt: "2026-09-01T00:00:00Z" }),
      member({ accountId: "b", email: "left@example.no", disabled: true }),
    ]);
    expect(out).toContain("Access ended");
    expect(out).toMatch(/Collaborator access ended 1 Sep(t)? 2026/);
    expect(out).toContain("Access removed");
    expect(out).not.toContain("Change role");
  });

  it("invites staff and collaborators with the roles to choose from", () => {
    const out = html(createElement(InviteForms, { roles, actions: { staff: action, collaborator: action } }));
    expect(out).toContain("Invite someone");
    expect(out).toContain("Invite a collaborator");
    expect(out).toContain("never an owner");
    expect(out).toContain('max="365"');
    expect(out).toContain('value="30"');
    // The collaborator form has no owner option: one owner option in all, in the staff form.
    expect(out.match(/<option value="owner"/g)).toHaveLength(1);
    expect(html(createElement("select", null, createElement(RoleOptions, { roles })))).toContain("Orders");
  });

  it("says how many of the team have two-step sign-in, and the store's requirement", () => {
    const off = html(createElement(TwoStepRequirement, { required: false, withIt: 1, total: 3, action }));
    expect(off).toContain("1 of 3 people on the team has it");
    expect(off).toMatch(/name="required"(?![^>]*checked)/);
    const on = html(createElement(TwoStepRequirement, { required: true, withIt: 3, total: 3, action }));
    expect(on).toContain("3 of 3 people on the team have it");
    expect(on).toMatch(/name="required"[^>]*checked=""/);
    expect(on).toContain("You need it on yourself first");
  });
});
