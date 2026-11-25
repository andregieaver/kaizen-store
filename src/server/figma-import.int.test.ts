import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { FigmaFrame } from "@/lib/figma-capture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const { importFigmaPage } = await import("./figma-import");
const { newStore } = await import("./inventory-test-support");

let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
let mine = "";
let theirs = "";

const ink = { r: 0.1, g: 0.1, b: 0.1, a: 1 };
const frame = (hash: string): FigmaFrame => ({
  name: "Spring sale",
  width: 1440,
  height: 800,
  tree: {
    id: "1:1",
    type: "FRAME",
    name: "Spring sale",
    box: [0, 0, 1440, 800],
    children: [
      {
        id: "1:2",
        type: "FRAME",
        name: "Hero",
        box: [0, 0, 1440, 640],
        layout: { mode: "HORIZONTAL", wrap: false, gap: 40, crossGap: 0, padding: [80, 120, 80, 120], main: "MIN", cross: "CENTER" },
        children: [
          {
            id: "1:3",
            type: "TEXT",
            name: "Title",
            box: [120, 240, 600, 80],
            text: { align: "LEFT", runs: [{ t: "Spring sale", family: "Fancy Grotesk Pro", style: "Bold", weight: 700, size: 64, color: ink, line: 72, tracking: 0 }] },
          },
          { id: "1:4", type: "RECTANGLE", name: "Photo", box: [760, 80, 560, 480], fills: [{ type: "IMAGE", hash }] },
        ],
      },
    ],
  },
});

const picture = async (storeId: string, name: string) =>
  String(
    (
      await db().execute<{ id: string }>(sql`
        insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, width, height)
        values (${storeId}::uuid, 'image', ${`https://files.example/${name}.webp`}, 'product-media', ${`${name}.webp`}, ${`${name}.webp`}, 'image/webp', 1120, 960)
        returning id`)
    )[0].id,
  );

beforeAll(async () => {
  store = await newStore("figma");
  other = await newStore("figmaother");
  mine = await picture(store.storeId, `mine-${store.slug}`);
  theirs = await picture(other.storeId, `theirs-${other.slug}`);
});

afterAll(async () => {
  await closeDb();
});

describe("a draft page from a Figma frame (D898 F2)", () => {
  it("builds the frame as a draft with the store's own picture, and stands in for a typeface Google Fonts lacks", async () => {
    const installed: string[] = [];
    const made = await importFigmaPage(
      { account: store.member.account, storeId: store.storeId },
      { file: "Shop.fig", desktop: frame("aa11"), pictures: { "image:aa11": { id: mine } } },
      { install: async (family) => (installed.push(family), { ok: true, family: "Inter" }) },
    );
    if (!made.ok) throw new Error(made.problem);
    expect(installed).toEqual(["Fancy Grotesk Pro"]);
    expect(made.notes.some((n) => n.includes("Fancy Grotesk Pro") && n.includes("Inter"))).toBe(true);
    const [page] = await db().execute<{ title: string; draft: { rows: unknown[] }; published: unknown }>(sql`
      select draft ->> 'title' as title, draft, published from commerce.pages where store_id = ${store.storeId}::uuid and id = ${made.id}::uuid`);
    expect(page).toMatchObject({ title: "Spring sale", published: null });
    expect(JSON.stringify(page.draft)).toContain(`mine-${store.slug}.webp`);
  });

  it("leaves out a picture that is not this store's, and refuses a frame it cannot read", async () => {
    const made = await importFigmaPage(
      { account: store.member.account, storeId: store.storeId },
      { desktop: frame("bb22"), pictures: { "image:bb22": { id: theirs } } },
      { install: async () => ({ ok: false, problem: "It is not in Google Fonts." }) },
    );
    if (!made.ok) throw new Error(made.problem);
    expect(made.notes.some((n) => /1 picture was not sent/.test(n))).toBe(true);
    const [page] = await db().execute<{ draft: unknown }>(sql`select draft from commerce.pages where id = ${made.id}::uuid`);
    expect(JSON.stringify(page.draft)).not.toContain("theirs-");

    expect(await importFigmaPage({ account: store.member.account, storeId: store.storeId }, { desktop: { name: "x" }, pictures: {} })).toMatchObject({ ok: false });
  });
});
