import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { DEFAULT_AUTONOMY } from "@/lib/autopilot-autonomy";
import { parseDesignDetails } from "@/lib/design-presets";

import type { Account } from "./auth";
import type { Store } from "./stores";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
// Google Fonts and Storage are outside the database: the themes here are made from scratch, so only fonts would be fetched.
vi.mock("./fonts", async (original) => ({
  ...(await original<typeof import("./fonts")>()),
  installFonts: async () => ({ ok: true }),
}));

const designs = await import("./design-presets");
const prices = await import("./theme-prices");
const tools = await import("./design-tools");
const { autopilotDecision } = await import("./autopilot-gate");
const assistant = await import("./owner-assistant");
const { OwnerToolError } = await import("./owner-tool-error");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);

let admin: Account;
let owner: Account;
let premium: string;
let free: string;

const deps = {
  copyFile: async (bucket: string, _from: string, to: string) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${to}`,
  installFonts: async () => ({ ok: true as const }),
};

/**
 * The AI manager's design tools (D308, `docs/ai-autopilot.md` 6): adding a theme never changes what visitors see, a theme made live by the
 * tool is the one Design settings makes live, and a theme that costs money never goes live without the charge the owner said yes to.
 */

async function account(email: string, platformAdmin = false): Promise<Account> {
  const [row] = await db().execute<Row>(
    sql`insert into commerce.accounts (email, name, platform_admin) values (${email}, 'Person', ${platformAdmin}) returning id, email`,
  );
  return {
    id: String(row.id),
    email: String(row.email),
    name: "Person",
    platformAdmin,
  };
}

/** A store of the owner's (an approved request), open to shoppers unless said. */
async function storeOf(slug: string, open = true): Promise<Store> {
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${owner.email}, 'Owner', ${slug}) returning id`,
  );
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${slug}, null) as id`);
  await db().execute(
    sql`update commerce.stores set country = 'NO', setup_completed_at = ${open ? sql`now()` : sql`null`} where id = ${String(id)}::uuid`,
  );
  return { id: String(id), slug } as Store;
}

async function theme(title: string): Promise<string> {
  const parsed = parseDesignDetails({ title, summary: "For the tools." });
  if (!parsed.ok) throw new Error(parsed.problems.join(" "));
  const made = await designs.createDesign(admin, { origin: { kind: "scratch" }, details: parsed.details }, deps);
  if (!made.ok) throw new Error(made.problems.join(" "));
  expect(await designs.publishDesign(admin, made.id)).toMatchObject({
    ok: true,
  });
  return made.id;
}

/** What visitors see of a store's look: the columns the live install is. */
async function lookOf(store: Store) {
  const [row] = await db().execute<Row>(sql`
    select theme, custom_css, header_id, footer_id, product_layout_id from commerce.stores where id = ${store.id}::uuid
  `);
  return row;
}

const ctxOf = (store: Store) => ({
  account: owner,
  store,
  invalidate: () => {},
});
const purchasesOf = async (store: Store) =>
  db().execute<Row>(sql`select status, currency, amount_minor::int as amount_minor from commerce.theme_purchases where store_id = ${store.id}::uuid`);

beforeAll(async () => {
  admin = await account(`dtools-admin-${run}@example.com`, true);
  owner = await account(`dtools-owner-${run}@example.com`);
  free = await theme(`Calm ${run}`);
  premium = await theme(`Grand ${run}`);
  expect(await prices.setThemePrices(admin, premium, [{ currency: "NOK", amountMinor: 349000 }])).toMatchObject({ ok: true });
});

afterAll(async () => {
  await closeDb();
});

describe("the design tools", () => {
  it("list the themes with what each costs, and add one to the library without changing what visitors see", async () => {
    const store = await storeOf(`dtools-add-${run}`);
    const listed = await tools.listThemesTool(ctxOf(store));
    expect(listed.themes.find((t) => t.theme === free)).toMatchObject({
      price: "Free.",
      in_library: false,
    });
    expect(listed.themes.find((t) => t.theme === premium)?.price).toContain("charged now");
    expect(listed.installed).toEqual([expect.objectContaining({ live: true })]);

    const before = await lookOf(store);
    const added = await tools.addThemeTool(ctxOf(store), { theme: premium });
    expect(added.install).toEqual(expect.any(String));
    expect(added.try).toBe(`/admin/${store.slug}/settings/design/themes/${added.install}/preview`);
    expect(await lookOf(store)).toEqual(before);
    // Adding a premium theme costs nothing.
    expect(await purchasesOf(store)).toHaveLength(0);
    const after = await tools.listThemesTool(ctxOf(store));
    expect(after.themes.find((t) => t.theme === premium)?.in_library).toBe(true);
    expect(after.installed.find((i) => i.install === added.install)).toMatchObject({ live: false, theme: premium });

    expect(await tools.tryThemeTool(ctxOf(store), { install: added.install })).toMatchObject({ live: false, preview: added.try });
    await expect(
      tools.tryThemeTool(ctxOf(store), {
        install: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toBeInstanceOf(OwnerToolError);
    await expect(tools.addThemeTool(ctxOf(store), { theme: free, preset: "nope" })).rejects.toThrow(/has no preset "nope"/);
  });

  it("make a theme live as Design settings does", async () => {
    const byTool = await storeOf(`dtools-tool-${run}`);
    const bySettings = await storeOf(`dtools-page-${run}`);
    const details = await tools.liveApprovalDetails(ctxOf(byTool), {
      theme: free,
    });
    expect(details).toMatchObject({
      category: "public",
      args: { theme: free, approved_charge: "free" },
    });
    expect(details?.summary).toMatch(/^Make the theme "Calm .*" live: visitors see its colours, fonts, header, footer and product page at once/);

    expect(await tools.makeThemeLiveTool(ctxOf(byTool), details!.args as never)).toMatchObject({ done: expect.stringContaining("is live") });
    expect(await designs.applyDesignPreset(bySettings.id, free, owner.id, deps)).toMatchObject({ ok: true });
    const [a, b] = [await lookOf(byTool), await lookOf(bySettings)];
    expect(a.theme).toEqual(b.theme);
    expect(a.custom_css).toEqual(b.custom_css);
    for (const key of ["header_id", "footer_id", "product_layout_id"]) expect(a[key] === null, key).toBe(b[key] === null);

    // Switching to an installed theme goes through the same switch as the page's.
    const listed = await tools.listThemesTool(ctxOf(byTool));
    const custom = listed.installed.find((i) => !i.live)!;
    await tools.makeThemeLiveTool(ctxOf(byTool), {
      install: custom.install,
      approved_charge: "free",
    });
    expect((await tools.listThemesTool(ctxOf(byTool))).installed.find((i) => i.live)?.install).toBe(custom.install);
    await expect(
      tools.preflightDesignTool(ctxOf(byTool), "make_theme_live", {
        install: custom.install,
      }),
    ).rejects.toThrow(/is live already/);
  });

  it("never make a theme that costs money live without the charge the owner said yes to", async () => {
    const store = await storeOf(`dtools-paid-${run}`);
    const before = await lookOf(store);
    const details = await tools.liveApprovalDetails(ctxOf(store), {
      theme: premium,
      approved_charge: "free",
    });
    // A value the model passed is replaced by the store's own.
    expect(details).toMatchObject({
      category: "spend",
      args: { approved_charge: "now:NOK:349000" },
    });
    expect(details?.summary).toContain("NOK");

    await expect(tools.makeThemeLiveTool(ctxOf(store), { theme: premium })).rejects.toThrow(prices.CHARGE_CHANGED);
    await expect(
      tools.makeThemeLiveTool(ctxOf(store), {
        theme: premium,
        approved_charge: "at_opening:NOK:349000",
      }),
    ).rejects.toThrow(prices.CHARGE_CHANGED);
    await expect(
      tools.makeThemeLiveTool(ctxOf(store), {
        theme: premium,
        approved_charge: "now:NOK:100",
      }),
    ).rejects.toThrow(prices.CHARGE_CHANGED);
    expect(await lookOf(store)).toEqual(before);
    expect(await purchasesOf(store)).toHaveLength(0);

    await tools.makeThemeLiveTool(ctxOf(store), details!.args as never);
    expect(await lookOf(store)).not.toEqual(before);
    expect(await purchasesOf(store)).toEqual([expect.objectContaining({ currency: "NOK", amount_minor: 349000 })]);
  });

  it("keep the charge with the approval and gate a paid theme as money spent", async () => {
    const store = await storeOf(`dtools-keep-${run}`);
    const [{ id: storeId }] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${store.slug}`);
    const { getStore } = await import("./stores");
    const full = (await getStore(store.slug))!;
    const [conversation] = await db().execute<Row>(sql`
      insert into commerce.assistant_conversations (store_id, account_id, title) values (${String(storeId)}::uuid, ${owner.id}::uuid, 'themes') returning id
    `);
    const approval = await assistant.keepForApproval(
      { account: owner, store: full, invalidate: () => {} },
      String(conversation.id),
      "make_theme_live",
      "public",
      {
        theme: premium,
        approved_charge: "free",
      },
    );
    expect(approval.category).toBe("spend");
    const [kept] = await db().execute<Row>(sql`select args from commerce.assistant_approvals where id = ${approval.id}::uuid`);
    expect(kept.args).toMatchObject({
      theme: premium,
      approved_charge: "now:NOK:349000",
    });
  });

  it("let the autopilot make a free theme live at the owner's level, and never one that costs money", async () => {
    const store = await storeOf(`dtools-auto-${run}`);
    const settings = {
      ...DEFAULT_AUTONOMY,
      levels: { design: "auto" as const },
    };
    expect(await autopilotDecision({ account: owner, store }, settings, "make_theme_live", "public", { theme: free })).toMatchObject({
      run: true,
      area: "design",
    });
    expect(await autopilotDecision({ account: owner, store }, settings, "make_theme_live", "public", { theme: premium })).toEqual({
      run: false,
      why: "This theme costs money, which always waits for your yes.",
    });
    expect(await autopilotDecision({ account: owner, store }, DEFAULT_AUTONOMY, "make_theme_live", "public", { theme: free })).toMatchObject({
      run: false,
    });
  });
});
