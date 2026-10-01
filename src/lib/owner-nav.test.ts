import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { ACCOUNT_EXTRA, ACCOUNT_ITEMS, ownerAreas, ownerTabs } from "./owner-nav";

const ROOT = "src/app/admin/(gated)/(owner)";

describe("the store owner's sections (D147)", () => {
  it("gives owners Home, Stores, Work and Account, and staff Stores and Account, with Work where a store has it on", () => {
    expect(ownerTabs({ owner: true, work: true }).map((t) => [t.label, t.icon])).toEqual([
      ["Home", "home"],
      ["Stores", "shopping-bag"],
      ["Work", "briefcase"],
      ["Account", "user"],
    ]);
    expect(ownerTabs({ owner: false, work: false }).map((t) => t.label)).toEqual(["Stores", "Account"]);
    expect(ownerTabs({ owner: false, work: true }).map((t) => t.label)).toEqual(["Stores", "Work", "Account"]);
  });

  it("marks Account on its own pages, and not on Work, which is under the same address", () => {
    const account = ownerTabs({ owner: true, work: true }).find((t) => t.label === "Account")!;
    expect(account).toMatchObject({ href: "/admin/account", exact: true });
    expect(account.also).toEqual(expect.arrayContaining(["/admin/account/billing", "/admin/account/usage", "/admin/account/referrals", "/admin/account/kaizen-life"]));
    expect(account.also!.some((p) => p.startsWith("/admin/account/work"))).toBe(false);
  });

  it("has a sidebar for Account (owners' pages only for owners) and for no other section", () => {
    const owner = ownerAreas({ owner: true, work: true });
    expect(owner.filter((a) => a.groups.length > 0)).toHaveLength(1);
    expect(owner.find((a) => a.groups.length > 0)!.groups[0].items.map((i) => i.label)).toEqual(["Your account", "Billing", "AI usage", "Referrals"]);
    const staff = ownerAreas({ owner: false, work: true });
    expect(staff.every((a) => a.groups.length === 0)).toBe(true);
  });

  it("links only pages the admin map knows", () => {
    const known = new Set(ADMIN_PAGES.filter((p) => p.area === "account").map((p) => p.path));
    for (const item of ACCOUNT_ITEMS) expect(known.has(item.path), item.path).toBe(true);
    expect(known.has("/stores")).toBe(true);
  });

  it("puts every page folder of the owner's level in a section", () => {
    const inAccount = new Set([...ACCOUNT_ITEMS.map((i) => i.path.split("/")[2]), ...ACCOUNT_EXTRA.map((p) => p.split("/")[2])].filter(Boolean));
    const dirs = (dir: string) => readdirSync(join(ROOT, dir)).filter((name) => statSync(join(ROOT, dir, name)).isDirectory());
    for (const sub of dirs("account")) expect(inAccount.has(sub) || sub === "work", `account/${sub}`).toBe(true);
    expect(dirs("")).toEqual(expect.arrayContaining(["account", "stores"]));
  });
});
