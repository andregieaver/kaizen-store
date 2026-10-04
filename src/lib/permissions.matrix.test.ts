import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import baseline from "./permissions.baseline.json";
import { ROLE_TEMPLATES, can, permissionOfPath, storePageKeys, type PermissionHolder } from "./permissions";

/**
 * The matrix of wave 1, 1f (docs/wave-1-trust.md 2.7.2): each system role and each template against every page of the
 * store admin, and the owner and admin columns against the baseline written before the sweep, so no page is gained or
 * lost by anyone who could use the admin before roles. (The scan test that every page and action calls a guard is
 * `permissions.scan.test.ts`, which belongs to the sweep.)
 */

type Entry = { file: string; surface: string; kind: string; path?: string; legacy: "member" | "owner" | "none"; calls: string[]; ownerChecks?: { line: number; text: string }[] };
const entries = baseline.entries as Entry[];

const owner: PermissionHolder = { role: "owner" };
const admin: PermissionHolder = { role: "admin" };
const template = (key: keyof typeof ROLE_TEMPLATES): PermissionHolder => ({ role: "admin", permissions: ROLE_TEMPLATES[key].permissions });

const storePages = ADMIN_PAGES.filter((p) => p.area === "store");

describe("what each role can open (the pages of the store admin)", () => {
  const openable = (holder: PermissionHolder, page: (typeof storePages)[number]) => {
    const key = page.needs === "owner" ? "owner" : permissionOfPath(page.path);
    return key === null ? true : can(holder, key);
  };

  it("lets the owner open every page", () => {
    for (const page of storePages) expect([page.id, openable(owner, page)]).toEqual([page.id, true]);
  });

  it("lets a default admin open every page but the owner's: no page gained or lost", () => {
    for (const page of storePages) expect([page.id, openable(admin, page)]).toEqual([page.id, page.needs !== "owner"]);
  });

  it("lets every role open Home and the setup steps, which are membership only", () => {
    for (const holder of [owner, admin, ...(Object.keys(ROLE_TEMPLATES) as (keyof typeof ROLE_TEMPLATES)[]).map(template)]) {
      for (const id of ["overview", "setup", "setup.step"]) {
        const page = storePages.find((p) => p.id === id)!;
        expect([id, openable(holder, page)]).toEqual([id, true]);
      }
    }
  });

  it("lets no template open an owner's page, and each only the areas it holds", () => {
    for (const key of Object.keys(ROLE_TEMPLATES) as (keyof typeof ROLE_TEMPLATES)[]) {
      const holder = template(key);
      for (const page of storePages) {
        const needed = page.needs === "owner" ? "owner" : permissionOfPath(page.path);
        const expected = needed === null ? true : needed === "owner" ? false : ROLE_TEMPLATES[key].permissions.includes(needed as never);
        expect([key, page.id, openable(holder, page)]).toEqual([key, page.id, expected]);
      }
    }
  });

  it("lets nobody write what they can only read", () => {
    const readOnly = template("read_only");
    for (const { id, path } of storePageKeys("write")) {
      const key = path === "" ? null : permissionOfPath(path, "write");
      if (key && key !== "owner") expect([id, can(readOnly, key)]).toEqual([id, false]);
    }
  });
});

describe("against the baseline written before the sweep", () => {
  const pageEntries = entries.filter((e) => e.surface === "store" && e.kind === "page" && e.path !== undefined);

  it("was written: it holds the store admin's entry points", () => {
    expect(entries.length).toBeGreaterThan(150);
    expect(pageEntries.length).toBeGreaterThan(100);
    expect(new Set(entries.map((e) => e.surface))).toEqual(expect.objectContaining(new Set(["store", "work", "server", "component"])));
  });

  it("names a page owner-only exactly where it asked for the owner role before: a page marked needs owner always did", () => {
    const owned = storePages.filter((p) => p.needs === "owner");
    for (const page of owned) {
      const found = pageEntries.filter((e) => e.path === page.path.replace(/\/$/, ""));
      // Every page marked owner-only that has a page file asked for the owner itself before roles.
      for (const e of found) expect([page.id, e.legacy]).toEqual([page.id, "owner"]);
    }
  });

  it("knows every page file in the admin map, and every store page file is in it", () => {
    const known = new Set(storePages.map((p) => p.path.replace(/\/$/, "")));
    const missing = pageEntries.filter((e) => !known.has(e.path!)).map((e) => e.path);
    expect(missing).toEqual([]);
  });

  it("derives an area for every page file that has one, from the navigation and not from the baseline", () => {
    for (const e of pageEntries) {
      const key = permissionOfPath(e.path!);
      if (key === null) expect(["", "/setup", "/setup/[step]"]).toContain(e.path);
    }
  });

  it("holds the three kinds of legacy requirement", () => {
    expect(new Set(entries.map((e) => e.legacy))).toEqual(new Set(["member", "owner", "none"]));
    expect(baseline.summary.member + baseline.summary.owner + baseline.summary.none).toBe(entries.length);
  });

  it("lists, for every file that asked for the owner role, the lines that say so", () => {
    for (const e of entries.filter((x) => x.legacy === "owner")) {
      expect([e.file, (e.ownerChecks ?? []).length > 0]).toEqual([e.file, true]);
    }
  });
});

describe("what each role can change (the server actions of the store admin, against the baseline)", () => {
  const actionEntries = entries.filter((e) => e.surface === "store" && e.kind === "action");
  const dirOf = (file: string) => "/" + file.split("(gated)/[store]/")[1].split("/").slice(0, -1).join("/");
  const keyOf = (file: string) => {
    const path = dirOf(file) === "/" ? "" : dirOf(file);
    const matched = ADMIN_PAGES.find((p) => p.area === "store" && p.path === path);
    return matched?.needs === "owner" ? ("owner" as const) : permissionOfPath(path, "write");
  };

  it("was written: the baseline holds the actions of the store admin", () => {
    expect(actionEntries.length).toBeGreaterThan(30);
  });

  it("lets the owner change everything, and a default admin everything an owner-only page does not keep from them", () => {
    for (const e of actionEntries) {
      const key = keyOf(e.file);
      if (key === null) continue; // Home and the setup wizard: membership only
      expect([e.file, can(owner, key)]).toEqual([e.file, true]);
      expect([e.file, can(admin, key)]).toEqual([e.file, key !== "owner"]);
    }
  });

  it("lets a template change only what it holds, and a read-only role nothing at all", () => {
    for (const e of actionEntries) {
      const key = keyOf(e.file);
      if (key === null || key === "owner") continue;
      for (const name of Object.keys(ROLE_TEMPLATES) as (keyof typeof ROLE_TEMPLATES)[]) {
        const held = ROLE_TEMPLATES[name].permissions.includes(key as never);
        expect([name, e.file, can(template(name), key)]).toEqual([name, e.file, held]);
      }
      expect([e.file, can(template("read_only"), key)]).toEqual([e.file, false]);
    }
  });

  it("never lets a role that was not an owner hold what the owner's actions keep: staff, billing and the owner key", () => {
    for (const key of ["owner", "staff:write", "billing:write"] as const) {
      for (const name of Object.keys(ROLE_TEMPLATES) as (keyof typeof ROLE_TEMPLATES)[]) expect([key, name, can(template(name), key)]).toEqual([key, name, false]);
      expect([key, can(admin, key)]).toEqual([key, false]);
      expect([key, can({ role: "admin", kind: "collaborator", permissions: [key] }, key)]).toEqual([key, false]);
    }
  });

  it("holds every file that asked for the owner role before roles to the owner key in an action, or to a page the map marks owner-only", () => {
    // The baseline's `owner` actions (the ones that checked the role) are owner-only now: the key their directory needs, or the owner key itself.
    const ownerActions = actionEntries.filter((e) => e.legacy === "owner");
    expect(ownerActions.length).toBeGreaterThan(10);
    for (const e of ownerActions) expect([e.file, (e.ownerChecks ?? []).length > 0]).toEqual([e.file, true]);
  });
});
