import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { ACCOUNT_EXTRA, ACCOUNT_GROUPS, ACCOUNT_ITEMS, BOOKS_PATH, SUPPORT_PATH, ownerAreas, ownerOpens, ownerTabs } from "./owner-nav";

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
    expect(account.also).toEqual(expect.arrayContaining(["/admin/account/billing", "/admin/account/usage", "/admin/account/referrals", "/admin/account/wordpress", "/admin/account/kaizen-life"]));
    expect(account.also!.some((p) => p.startsWith("/admin/account/work"))).toBe(false);
  });

  it("has a sidebar for Account (owners' pages only for owners) and for no other section", () => {
    const owner = ownerAreas({ owner: true, work: true });
    expect(owner.filter((a) => a.groups.length > 0)).toHaveLength(1);
    const labels = (areas: ReturnType<typeof ownerAreas>) => areas.find((a) => a.groups.length > 0)!.groups.map((g) => [g.heading, g.items.map((i) => i.label)]);
    // In three groups (code review FN4, D884), the person's own first.
    expect(labels(owner)).toEqual([
      ["Personal", ["Your account", "Appearance", "AI manager notices", "Kaizena Flow support"]],
      ["Billing and usage", ["Your domains", "Billing", "Extensions", "Add to your account", "AI usage", "Usage and limits", "Referrals"]],
      ["Apps and themes", ["Your themes", "Connected apps and assistants", "Developer", "WordPress"]],
    ]);
    expect(ACCOUNT_ITEMS.map((i) => i.label)).toEqual(labels(owner).flatMap(([, items]) => items));
    const staff = ownerAreas({ owner: false, work: true });
    expect(staff.every((a) => a.groups.length === 0)).toBe(true);
    // Someone who holds a domain but owns no store (D317) sees their account's pages and Your domains, not the owners' pages.
    const holder = ownerAreas({ owner: false, work: false, domains: true });
    expect(labels(holder)).toEqual([
      ["Personal", ["Your account", "Appearance", "Kaizena Flow support"]],
      ["Billing and usage", ["Your domains"]],
      ["Apps and themes", ["Your themes", "Connected apps and assistants", "Developer"]],
    ]);
  });

  it("keeps Account's Basic view to the everyday pages, Your account always among them (D884, as a store's D454)", () => {
    const links = ownerAreas({ owner: true, work: true }).flatMap((a) => a.groups.flatMap((g) => g.items));
    const basic = links.filter((l) => !l.advanced).map((l) => l.label);
    expect(basic).toEqual(["Your account", "Kaizena Flow support", "Your domains", "Billing", "Add to your account"]);
    expect(basic.length).toBeGreaterThan(0);
    expect(basic.length).toBeLessThan(links.length / 2);
    // The page the Account tab leads to is in Basic whatever its item says.
    const tab = ownerTabs({ owner: true, work: true }).find((t) => t.label === "Account")!;
    expect(links.find((l) => l.href === tab.href)!.advanced).toBeUndefined();
    // What a person builds or connects is Lisa's: in Basic the group is left out, and the sidebar's foot says how many more Advanced has.
    expect(ACCOUNT_GROUPS.filter((g) => !g.items.some((i) => i.basic)).map((g) => g.heading)).toEqual(["Apps and themes"]);
  });

  it("offers in the page finder what the tabs and the sidebar show (ecosystem plan E2.2, D713)", () => {
    const staff = { owner: false, work: false };
    expect(ownerOpens({ owner: true, work: true }, "")).toBe(true);
    expect(ownerOpens(staff, "")).toBe(false);
    expect(ownerOpens(staff, "/stores")).toBe(true);
    expect(ownerOpens(staff, "/account")).toBe(true);
    expect(ownerOpens(staff, "/account/billing")).toBe(false);
    expect(ownerOpens(staff, "/account/work")).toBe(false);
    expect(ownerOpens({ ...staff, work: true }, "/account/work/invoices")).toBe(true);
    expect(ownerOpens(staff, SUPPORT_PATH)).toBe(false);
    expect(ownerOpens({ ...staff, support: true }, SUPPORT_PATH)).toBe(true);
    expect(ownerOpens({ ...staff, books: true }, BOOKS_PATH)).toBe(true);
    // A page of an Account item goes with it: buying a domain is for a holder or an owner.
    expect(ownerOpens(staff, "/account/domains/buy")).toBe(false);
    expect(ownerOpens({ ...staff, domains: true }, "/account/domains/buy")).toBe(true);
    expect(ownerOpens(staff, "/account/delete")).toBe(true);
  });

  it("links only pages the admin map knows", () => {
    const known = new Set(ADMIN_PAGES.filter((p) => p.area === "account").map((p) => p.path));
    for (const item of ACCOUNT_ITEMS) expect(known.has(item.path), item.path).toBe(true);
    expect(known.has("/stores")).toBe(true);
  });

  it("puts every page folder of the owner's level in a section", () => {
    const inAccount = new Set([...ACCOUNT_ITEMS.map((i) => i.path.split("/")[2]), ...ACCOUNT_EXTRA.map((p) => p.split("/")[2])].filter(Boolean));
    const dirs = (dir: string) => readdirSync(join(ROOT, dir)).filter((name) => statSync(join(ROOT, dir, name)).isDirectory());
    // Work, Support (D216) and Books (an accountant's clients, D512) are tabs of their own, not Account's pages.
    for (const sub of dirs("account")) expect(inAccount.has(sub) || sub === "work" || `/account/${sub}` === SUPPORT_PATH || `/account/${sub}` === BOOKS_PATH, `account/${sub}`).toBe(true);
    expect(dirs("")).toEqual(expect.arrayContaining(["account", "stores"]));
  });
});
