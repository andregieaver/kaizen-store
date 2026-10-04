import { describe, expect, it } from "vitest";

import { levelField, levelsFromForm, parseRoleChoice, roleChoiceValue, roleFromForm, roleSummary } from "./role-form";

const form = (entries: Record<string, string>) => (name: string) => entries[name];

describe("the role editor's form", () => {
  it("reads one level per working area and treats anything else as no access", () => {
    const levels = levelsFromForm(form({ [levelField("orders")]: "write", [levelField("products")]: "read", [levelField("customers")]: "bogus" }));
    expect(levels).toMatchObject({ orders: "write", products: "read", customers: "none", marketing: "none", settings: "none" });
  });

  it("never reads Team or Billing: a role cannot hold them", () => {
    const levels = levelsFromForm(form({ [levelField("staff")]: "write", [levelField("billing")]: "write" }));
    expect(levels).not.toHaveProperty("staff");
    expect(levels).not.toHaveProperty("billing");
    expect(roleFromForm(form({ name: "Sneaky", [levelField("staff")]: "write", [levelField("billing")]: "read" })).permissions).toEqual([]);
  });

  it("makes normalised keys: a change comes with its view", () => {
    expect(roleFromForm(form({ name: "Orders", [levelField("orders")]: "write", [levelField("customers")]: "read" }))).toEqual({
      name: "Orders",
      permissions: ["orders:read", "orders:write", "customers:read"],
    });
  });
});

describe("giving a member a role", () => {
  it("reads the owner, the default admin and a custom role by its id, and nothing else", () => {
    const id = "6f1c0b9e-1111-4222-8333-444455556666";
    expect(parseRoleChoice("owner")).toEqual({ kind: "owner" });
    expect(parseRoleChoice("admin")).toEqual({ kind: "admin" });
    expect(parseRoleChoice(`role:${id}`)).toEqual({ kind: "role", roleId: id });
    expect(parseRoleChoice(`role:${id.toUpperCase()}`)).toEqual({ kind: "role", roleId: id });
    for (const bad of ["", "role:", "role:not-a-uuid", "superuser", null, undefined, 3]) expect(parseRoleChoice(bad)).toBeNull();
  });

  it("round-trips through the select's value", () => {
    const id = "6f1c0b9e-1111-4222-8333-444455556666";
    for (const choice of [{ kind: "owner" }, { kind: "admin" }, { kind: "role", roleId: id }] as const) expect(parseRoleChoice(roleChoiceValue(choice))).toEqual(choice);
  });
});

describe("a sentence on what a role holds", () => {
  it("says what it can change and what it can only view", () => {
    expect(roleSummary(["orders:read", "orders:write", "customers:read", "products:read"])).toBe("Can change orders; can view products and customers.");
    expect(roleSummary(["analytics:read"])).toBe("Can view analytics.");
    expect(roleSummary(["products:write", "products:read"])).toBe("Can change products.");
    expect(roleSummary([])).toBe("No access to anything yet.");
  });
});
