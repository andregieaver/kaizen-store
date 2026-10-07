import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseDesignDetails } from "@/lib/design-presets";
import { defaultHeader } from "@/lib/site-layout";

import type { Account } from "./auth";

/**
 * A design profile's editor (D177): its actions, bound to the profile, refuse anyone who does not run the platform, and change only that
 * profile's workspace (its chosen header, footer or product layout; never another store's page, never another profile's). The signed-in
 * person is stood in for here; everything else is the real server code against the database.
 */
let current: Account;
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));
vi.mock("@/server/auth", async (original) => ({
  ...(await original<typeof import("./auth")>()),
  requirePlatformAdmin: async () => {
    if (!current.platformAdmin) throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
    return current;
  },
}));

const designs = await import("./design-presets");
const actions = await import("@/app/admin/(gated)/platform/design-profiles/[presetId]/workspace-actions");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];
const deps = { copyFile: async (bucket: string, _from: string, to: string) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${to}`, installFonts: async () => ({ ok: true as const }) };

let admin: Account;
let owner: Account;
let presetId: string;
let otherPreset: string;
let workspaceId: string;
let headerId: string;
let foreignPage: string;

async function account(email: string, platformAdmin: boolean): Promise<Account> {
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${email}, 'A', ${platformAdmin}) returning id, email`);
  return { id: String(row.id), email: String(row.email), name: "A", platformAdmin };
}

function details(title: string) {
  const parsed = parseDesignDetails({ title });
  if (!parsed.ok) throw new Error(parsed.problems.join(" "));
  return parsed.details;
}

beforeAll(async () => {
  admin = await account(`ws-admin-${run}@example.com`, true);
  owner = await account(`ws-owner-${run}@example.com`, false);
  current = admin;
  const made = await designs.createDesign(admin, { origin: { kind: "scratch" }, details: details(`Workspace ${run}`) }, deps);
  presetId = (made as { id: string }).id;
  const other = await designs.createDesign(admin, { origin: { kind: "scratch" }, details: details(`Other ${run}`) }, deps);
  otherPreset = (other as { id: string }).id;
  workspaceId = (await designs.getDesign(presetId))!.workspaceStoreId!;
  headerId = ((await designs.chooseWorkspaceLayout(admin, presetId, "header", "build")) as { pageId: string }).pageId;
  // A header of another store (the other profile's workspace): never saved through this profile.
  const otherHeader = await designs.chooseWorkspaceLayout(admin, otherPreset, "header", "build");
  foreignPage = (otherHeader as { pageId: string }).pageId;
});

afterAll(async () => {
  await closeDb();
});

const payload = (title: string) => JSON.stringify({ ...defaultHeader(workspaceId), title, slug: "header-profile" });

describe("the design profile editor's actions (D177)", () => {
  it("saves the profile's chosen header as a draft only", async () => {
    const before = await one(sql`select published from commerce.pages where id = ${headerId}::uuid`);
    const saved = await actions.saveWorkspacePageAction(presetId, "header", headerId, payload("Calm header"));
    expect(saved).toMatchObject({ status: "saved", page: { id: headerId } });
    const after = await one(sql`select draft ->> 'title' as title, published from commerce.pages where id = ${headerId}::uuid`);
    expect(after.title).toBe("Calm header");
    expect(after.published).toEqual(before.published);
  });

  it("refuses a page that is not this profile's workspace's chosen one, and another kind", async () => {
    expect(await actions.saveWorkspacePageAction(presetId, "header", foreignPage, payload("Sneaky"))).toEqual({ status: "error", problems: ["Unknown page."] });
    expect(await actions.saveWorkspacePageAction(presetId, "footer", headerId, payload("Sneaky"))).toEqual({ status: "error", problems: ["Unknown page."] });
    expect(await actions.saveWorkspacePageAction(presetId, "page", headerId, payload("Sneaky"))).toEqual({ status: "error", problems: ["Unknown page."] });
    expect((await one(sql`select draft ->> 'title' as title from commerce.pages where id = ${foreignPage}::uuid`)).title).not.toBe("Sneaky");
    // A store's own page, chosen in that store, is no workspace's.
    const store = await one(sql`select id, header_id from commerce.stores where is_template`);
    if (store.header_id) {
      expect(await actions.saveWorkspacePageAction(presetId, "header", String(store.header_id), payload("Sneaky"))).toEqual({ status: "error", problems: ["Unknown page."] });
    }
  });

  it("writes the theme and CSS of the profile's workspace only", async () => {
    const theme = await one(sql`select theme from commerce.stores where id = ${workspaceId}::uuid`);
    expect(await actions.saveWorkspaceCssAction(presetId, ".hero { letter-spacing: .01em }")).toEqual({ ok: true });
    expect((await one(sql`select custom_css from commerce.stores where id = ${workspaceId}::uuid`)).custom_css).toBe(".hero { letter-spacing: .01em }");
    expect(await actions.saveWorkspaceThemeAction(presetId, JSON.stringify(theme.theme))).toMatchObject({ ok: true });
    // A profile id that is not one: nothing is written anywhere.
    expect(await actions.saveWorkspaceCssAction(crypto.randomUUID(), ".x{}")).toMatchObject({ ok: false });
  });

  it("refuses anyone who does not run the platform, before anything is read or written", async () => {
    current = owner;
    try {
      await expect(actions.saveWorkspacePageAction(presetId, "header", headerId, payload("Owner"))).rejects.toThrow(/404/);
      await expect(actions.saveWorkspaceCssAction(presetId, ".x{}")).rejects.toThrow(/404/);
      await expect(actions.saveWorkspaceThemeAction(presetId, "{}")).rejects.toThrow(/404/);
      await expect(actions.chooseWorkspaceLayoutAction(presetId, "header", "standard")).rejects.toThrow(/404/);
      await expect(actions.uploadWorkspaceImageAction(presetId, new FormData())).rejects.toThrow(/404/);
    } finally {
      current = admin;
    }
    expect((await one(sql`select draft ->> 'title' as title from commerce.pages where id = ${headerId}::uuid`)).title).toBe("Calm header");
  });

  it("never unpublishes, deletes or duplicates a profile's page from the builder", async () => {
    expect(await actions.unpublishWorkspacePageAction()).toMatchObject({ status: "error" });
    expect(await actions.removeWorkspacePageAction()).toMatchObject({ problems: [expect.any(String)] });
    expect(await actions.duplicateWorkspacePageAction()).toMatchObject({ ok: false });
    expect((await one(sql`select count(*)::int as n from commerce.pages where id = ${headerId}::uuid`)).n).toBe(1);
  });
});
