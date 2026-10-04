import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import {
  ADMIN_DEFAULT,
  AREAS,
  AREA_PERMISSIONS,
  COLLABORATOR_DAYS,
  GRANTABLE_PERMISSIONS,
  OWNER_HELD,
  PERMISSION_KEYS,
  ROLE_TEMPLATES,
  ROLE_TEMPLATE_KEYS,
  WORKING_AREAS,
  accessEnded,
  areaOfPath,
  can,
  collaboratorDays,
  collaboratorExpiry,
  levelIn,
  normalisePermissions,
  permissionOfPath,
  permissionsFromLevels,
  permissionsOf,
  storePageKeys,
  type PermissionHolder,
} from "./permissions";
import { STORE_SECTIONS, sectionPaths } from "./store-nav";

const owner: PermissionHolder = { role: "owner" };
const admin: PermissionHolder = { role: "admin" };
const withRole = (permissions: string[], extra: Partial<PermissionHolder> = {}): PermissionHolder => ({ role: "admin", permissions, ...extra });

describe("the keys", () => {
  it("are ten areas with read and write, and the owner key: 21 in all, 18 of them grantable", () => {
    expect(AREAS).toHaveLength(10);
    expect(AREA_PERMISSIONS).toHaveLength(20);
    expect(PERMISSION_KEYS).toHaveLength(21);
    expect(GRANTABLE_PERMISSIONS).toHaveLength(18);
    expect(OWNER_HELD).toEqual(["owner", "staff:write", "billing:write"]);
    for (const key of OWNER_HELD) expect(GRANTABLE_PERMISSIONS as readonly string[]).not.toContain(key);
  });

  it("are the areas of the store navigation, and the navigation has no section the keys lack", () => {
    for (const section of STORE_SECTIONS) expect(AREAS as readonly string[]).toContain(section.key);
    for (const area of WORKING_AREAS) expect(STORE_SECTIONS.map((s) => s.key as string)).toContain(area);
  });

  it("give the default admin what an admin could do before roles: every working area, and to see the team and the plan", () => {
    expect(ADMIN_DEFAULT).toHaveLength(WORKING_AREAS.length * 2 + 2);
    expect(ADMIN_DEFAULT).toEqual(expect.arrayContaining(["orders:write", "settings:write", "staff:read", "billing:read"]));
    expect(ADMIN_DEFAULT as readonly string[]).not.toContain("staff:write");
    expect(ADMIN_DEFAULT as readonly string[]).not.toContain("billing:write");
  });
});

describe("can()", () => {
  it("lets an owner do everything, the owner key included", () => {
    for (const key of PERMISSION_KEYS) expect([key, can(owner, key)]).toEqual([key, true]);
  });

  it("lets a default admin do what the default set says, and never the owner's", () => {
    for (const key of PERMISSION_KEYS) expect([key, can(admin, key)]).toEqual([key, (ADMIN_DEFAULT as readonly string[]).includes(key)]);
    expect(can(admin, "owner")).toBe(false);
    expect(can(admin, "staff:write")).toBe(false);
    expect(can(admin, "billing:write")).toBe(false);
  });

  it("gives a custom role exactly its keys, with write including read", () => {
    const role = withRole(["orders:write", "customers:read"]);
    expect(can(role, "orders:write")).toBe(true);
    expect(can(role, "orders:read")).toBe(true);
    expect(can(role, "customers:read")).toBe(true);
    expect(can(role, "customers:write")).toBe(false);
    expect(can(role, "products:read")).toBe(false);
    expect(can(role, "settings:read")).toBe(false);
    expect(can(role, "staff:read")).toBe(false);
    expect(can(role, "owner")).toBe(false);
  });

  it("gives a role with no keys nothing, which is not the default set", () => {
    const empty = withRole([]);
    for (const key of PERMISSION_KEYS) expect([key, can(empty, key)]).toEqual([key, false]);
    expect(permissionsOf({ role: "admin", permissions: null })).toEqual(permissionsOf(admin));
  });

  it("never lets a stored role hold what only an owner holds, even if the database were made to say so", () => {
    const sneaky = withRole(["staff:write", "billing:write", "owner", "orders:read"]);
    expect(can(sneaky, "staff:write")).toBe(false);
    expect(can(sneaky, "billing:write")).toBe(false);
    expect(can(sneaky, "owner")).toBe(false);
    expect(can(sneaky, "orders:read")).toBe(true);
  });

  it("ignores a key that is not one", () => {
    const odd = withRole(["orders:delete", "ORDERS:READ", "everything", ""]);
    for (const key of PERMISSION_KEYS) expect([key, can(odd, key)]).toEqual([key, false]);
  });

  it("never lets a collaborator see the team or the plan, whatever the role", () => {
    const collaborator = (permissions: string[] | null) => ({ role: "admin" as const, kind: "collaborator" as const, permissions });
    expect(can(collaborator(null), "staff:read")).toBe(false);
    expect(can(collaborator(null), "billing:read")).toBe(false);
    expect(can(collaborator(null), "orders:write")).toBe(true);
    expect(can(collaborator(["staff:read", "billing:read", "orders:read"]), "staff:read")).toBe(false);
    expect(can(collaborator(["staff:read", "billing:read", "orders:read"]), "billing:read")).toBe(false);
    expect(can(collaborator(["staff:read", "billing:read", "orders:read"]), "orders:read")).toBe(true);
    expect(can(collaborator(null), "owner")).toBe(false);
  });
});

describe("normalising a role's keys", () => {
  it("adds the read of every write, drops what cannot be granted, and puts them in order", () => {
    expect(normalisePermissions(["products:write", "orders:write", "orders:read", "staff:write", "owner", "nonsense"])).toEqual(["orders:read", "orders:write", "products:read", "products:write"]);
    expect(normalisePermissions([])).toEqual([]);
    expect(normalisePermissions(["staff:read", "billing:read"])).toEqual(["billing:read", "staff:read"]);
  });

  it("is idempotent", () => {
    const once = normalisePermissions(["website:write", "analytics:read"]);
    expect(normalisePermissions(once)).toEqual(once);
  });

  it("is made from a role editor's levels", () => {
    expect(permissionsFromLevels({ orders: "write", products: "read", customers: "none" })).toEqual(["orders:read", "orders:write", "products:read"]);
    expect(permissionsFromLevels({ staff: "write", billing: "write" })).toEqual([]); // not grantable
    expect(permissionsFromLevels({})).toEqual([]);
    expect(levelIn(["orders:read", "orders:write", "products:read"], "orders")).toBe("write");
    expect(levelIn(["orders:read", "orders:write", "products:read"], "products")).toBe("read");
    expect(levelIn(["orders:read"], "customers")).toBe("none");
  });
});

describe("the key a page needs", () => {
  it("is its navigation section's, with read for a page and write for an action", () => {
    expect(permissionOfPath("/orders")).toBe("orders:read");
    expect(permissionOfPath("/orders/[orderId]")).toBe("orders:read");
    expect(permissionOfPath("/orders/6f1c0b9e/packing-slip")).toBe("orders:read");
    expect(permissionOfPath("/orders", "write")).toBe("orders:write");
    expect(permissionOfPath("/products/new")).toBe("products:read");
    expect(permissionOfPath("/discounts/[discountId]", "write")).toBe("marketing:write");
    expect(permissionOfPath("/analytics/finance")).toBe("analytics:read");
    expect(permissionOfPath("/pages/[pageId]")).toBe("website:read");
    expect(permissionOfPath("/settings/design")).toBe("website:read"); // Design is the Website's
    expect(permissionOfPath("/settings/shipping")).toBe("settings:read");
    expect(permissionOfPath("/bookings/staff/[staffId]")).toBe("bookings:read");
    expect(permissionOfPath("/hosts")).toBe("bookings:read");
  });

  it("is in the staff and billing areas for the team and the plan, which live in the Settings sidebar", () => {
    expect(areaOfPath("/staff")).toBe("staff");
    expect(areaOfPath("/staff/roles")).toBe("staff");
    expect(areaOfPath("/billing")).toBe("billing");
    // Both pages are owner-only (`needs: "owner"` in the admin map), so the key they ask for is the owner's in this wave:
    // staff:write and billing:write are held by owners only, and the read keys serve the activity log's team entries.
    for (const access of ["read", "write"] as const) {
      expect(permissionOfPath("/staff", access)).toBe("owner");
      expect(permissionOfPath("/billing", access)).toBe("owner");
    }
  });

  it("is the owner key for a page marked owner-only", () => {
    const ownerOnly = ADMIN_PAGES.filter((p) => p.area === "store" && p.needs === "owner");
    expect(ownerOnly.map((p) => p.id)).toEqual(expect.arrayContaining(["assistant", "returns.settings", "payments", "analytics.settings", "features", "billing", "staff"]));
    for (const page of ownerOnly) expect([page.id, permissionOfPath(page.path)]).toEqual([page.id, "owner"]);
    expect(permissionOfPath("/assistant")).toBe("owner");
    expect(permissionOfPath("/settings/payments")).toBe("owner");
  });

  it("is nothing for the activity log, which every member opens and which narrows itself to what they can read", () => {
    expect(permissionOfPath("/activity")).toBeNull();
    expect(permissionOfPath("/activity", "write")).toBeNull();
  });

  it("is nothing for Home, which is membership only", () => {
    expect(permissionOfPath("")).toBeNull();
    expect(areaOfPath("")).toBeNull();
    expect(permissionOfPath("/setup")).toBeNull();
  });

  it("tolerates a slash or two", () => {
    expect(permissionOfPath("orders")).toBe("orders:read");
    expect(permissionOfPath("/orders/")).toBe("orders:read");
  });

  it("is known for every page of the store admin: a page with no area is Home's and nothing else", () => {
    const keys = storePageKeys();
    const noArea = keys.filter((k) => k.key === null).map((k) => k.id).sort();
    expect(noArea).toEqual(["activity", "overview", "setup", "setup.step"]);
    expect(keys.length).toBe(ADMIN_PAGES.filter((p) => p.area === "store").length);
  });

  it("puts every address in the navigation in an area the keys know", () => {
    for (const section of STORE_SECTIONS) {
      for (const path of sectionPaths(section)) {
        const area = areaOfPath(path);
        expect([path, area !== null && (AREAS as readonly string[]).includes(area)]).toEqual([path, true]);
      }
    }
  });
});

describe("the role templates", () => {
  it("are the six the owner is offered", () => {
    expect(ROLE_TEMPLATE_KEYS).toEqual(["orders", "products", "marketing", "content", "analytics", "read_only"]);
    expect(Object.values(ROLE_TEMPLATES).map((t) => t.name)).toEqual(["Orders", "Products", "Marketing", "Content", "Analytics", "Read-only"]);
  });

  it("hold only grantable keys, already normalised", () => {
    for (const [key, template] of Object.entries(ROLE_TEMPLATES)) {
      expect([key, template.permissions]).toEqual([key, normalisePermissions(template.permissions)]);
      for (const permission of template.permissions) expect(GRANTABLE_PERMISSIONS as readonly string[]).toContain(permission);
      expect(template.description.length).toBeGreaterThan(10);
    }
  });

  it("do what their names say", () => {
    const holder = (key: keyof typeof ROLE_TEMPLATES) => withRole(ROLE_TEMPLATES[key].permissions);
    expect(can(holder("orders"), "orders:write")).toBe(true);
    expect(can(holder("orders"), "products:write")).toBe(false);
    expect(can(holder("products"), "products:write")).toBe(true);
    expect(can(holder("products"), "orders:read")).toBe(false);
    expect(can(holder("marketing"), "marketing:write")).toBe(true);
    expect(can(holder("marketing"), "analytics:read")).toBe(true);
    expect(can(holder("content"), "website:write")).toBe(true);
    expect(can(holder("content"), "settings:read")).toBe(false);
    expect(can(holder("analytics"), "analytics:read")).toBe(true);
  });

  it("make read-only see everything but billing and the team, and change nothing", () => {
    const readOnly = withRole(ROLE_TEMPLATES.read_only.permissions);
    for (const area of WORKING_AREAS) {
      expect([area, can(readOnly, `${area}:read`)]).toEqual([area, true]);
      expect([area, can(readOnly, `${area}:write`)]).toEqual([area, false]);
    }
    for (const key of ["billing:read", "billing:write", "staff:read", "staff:write", "owner"] as const) expect([key, can(readOnly, key)]).toEqual([key, false]);
  });
});

describe("collaborators", () => {
  const now = new Date("2026-10-03T12:00:00Z");

  it("last 1 to 365 days, 30 by default, whole days only", () => {
    expect(COLLABORATOR_DAYS).toEqual({ min: 1, max: 365, default: 30 });
    expect(collaboratorDays(30)).toBe(30);
    expect(collaboratorDays("14")).toBe(14);
    expect(collaboratorDays(1)).toBe(1);
    expect(collaboratorDays(365)).toBe(365);
    for (const bad of [0, 366, -1, 1.5, "", "x", null, undefined, NaN, "0"]) expect([bad, collaboratorDays(bad)]).toEqual([bad, null]);
  });

  it("end the given number of days after they are invited", () => {
    expect(collaboratorExpiry(now, 30).toISOString()).toBe("2026-11-02T12:00:00.000Z");
    expect(collaboratorExpiry(now, 1).toISOString()).toBe("2026-10-04T12:00:00.000Z");
  });

  it("have ended at the moment they expire, not a moment after", () => {
    const expires = new Date("2026-10-10T00:00:00Z");
    expect(accessEnded(expires, new Date("2026-10-09T23:59:59Z"))).toBe(false);
    expect(accessEnded(expires, expires)).toBe(true);
    expect(accessEnded(expires, new Date("2026-10-10T00:00:01Z"))).toBe(true);
    expect(accessEnded(null, now)).toBe(false);
    expect(accessEnded(undefined, now)).toBe(false);
  });
});
