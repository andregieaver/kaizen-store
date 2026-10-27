import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/db/client";
import type { OwnerToolInput } from "@/lib/owner-tools";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const tools = await import("./content-tools");
const { contentWork, writeEntryUnit } = await import("./content-translate");
const { getEntry } = await import("./content-entries");
const { newStore } = await import("./inventory-test-support");
const { getStore } = await import("./stores");

/**
 * The AI manager's content tools (wave 6 unit H3, D326): a type made from labels, an entry written as a draft by field names, publishing
 * refused before it is kept for a yes while a required field is empty, and the words of a kept change naming the entry.
 */

let ctx: Parameters<typeof tools.listContentTypesTool>[0];
let entryId = "";

beforeAll(async () => {
  const made = await newStore("content-tools");
  ctx = { account: made.member.account, store: (await getStore(made.slug))!, invalidate: () => {} };
});

afterAll(async () => {
  await closeDb();
});

describe("the content tools (D326)", () => {
  it("makes a type from labels, its first text field its title, its fields shown on the site unless said", async () => {
    const input = {
      name: "Team members",
      fields: [
        { label: "Name", type: "text", required: true, access: "public" },
        { label: "Role", type: "text", required: true, access: "public" },
        { label: "Phone", type: "phone", required: false, access: "private" },
      ],
    } as OwnerToolInput<"save_content_type">;
    await tools.preflightContentTool(ctx, "save_content_type", input as Record<string, unknown>);
    const saved = await tools.saveContentTypeTool(ctx, input);
    expect(saved.key).toMatch(/^t_[0-9a-f]{12}$/);
    const listed = await tools.listContentTypesTool(ctx);
    expect(listed.types[0]).toMatchObject({ name: "Team members", web_name: "team-members", has_pages: true });
    expect(listed.types[0].fields.map((f) => [f.label, f.shown_on_site])).toEqual([["Name", true], ["Role", true], ["Phone", false]]);
    expect(listed.types[0].fields[0]).toMatchObject({ title: true });
    // A type without a text field for its title is refused before the owner is asked.
    await expect(tools.preflightContentTool(ctx, "save_content_type", { name: "Dates", fields: [{ label: "When", type: "date" }] })).rejects.toThrow(/title/);
  });

  it("writes a draft by field names, and refuses publishing it before a required field is filled", async () => {
    const draft = await tools.saveEntryTool(ctx, { type: "team-members", values: { Name: "Kari Nordmann" } } as OwnerToolInput<"save_entry">);
    entryId = draft.id!;
    await expect(tools.preflightContentTool(ctx, "publish_entry", { entry: entryId })).rejects.toThrow(/Role is required/);
    await tools.saveEntryTool(ctx, { type: "team-members", entry: entryId, values: { role: "Baker" } } as OwnerToolInput<"save_entry">);
    await tools.preflightContentTool(ctx, "publish_entry", { entry: entryId });
    expect(await tools.contentApprovalWords(ctx, "publish_entry", { entry: entryId })).toBe('Publish "Kari Nordmann" on the site as its draft is now.');
    await tools.publishEntryTool(ctx, { entry: entryId });
    const listed = await tools.listEntriesTool(ctx, { type: "team-members", limit: 10 } as OwnerToolInput<"list_entries">);
    expect(listed.entries).toEqual([{ id: entryId, title: "Kari Nordmann", status: "published", address: "/team-members/kari-nordmann" }]);
    const read = await tools.getEntryTool(ctx, { entry: entryId });
    expect(read.fields.map((f) => [f.name, f.value])).toEqual([["name", "Kari Nordmann"], ["role", "Baker"], ["phone", null]]);
  });

  it("refuses claims, unknown fields and another type's entry", async () => {
    await expect(tools.saveEntryTool(ctx, { type: "team-members", values: { Nickname: "x" } } as OwnerToolInput<"save_entry">)).rejects.toThrow(/no field "Nickname"/);
    await expect(tools.saveEntryTool(ctx, { type: "nothing", values: {} } as OwnerToolInput<"save_entry">)).rejects.toThrow(/no content type/);
    await expect(tools.preflightContentTool(ctx, "unpublish_entry", { entry: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(/no such entry/);
  });

  it("is in the translation worklist, and an accepted translation goes into the entry's draft", async () => {
    const main = ctx.store.localization.locales[0];
    const units = await contentWork(ctx.store.id, main, "en", "missing");
    const unit = units.find((u) => u.id === `entry:${entryId}`)!;
    expect(unit).toMatchObject({ scope: "content", title: "Kari Nordmann", kind: "Team members", legal: false });
    const role = unit.items.find((item) => item.label === "Role")!;
    const member = { account: ctx.account, store: { ...ctx.store, localization: { ...ctx.store.localization, locales: [main, "en"] } }, role: "owner" } as Parameters<typeof writeEntryUnit>[0];
    expect(await writeEntryUnit(member, unit.id, "en", { [role.key]: "Baker (en)" })).toBe(true);
    const entry = (await getEntry(ctx.store.id, entryId))!;
    expect(Object.values(entry.draft.data.translations.en ?? {})).toContain("Baker (en)");
    // What is published is not changed: an entry is published by a person.
    expect(entry.published?.data.translations.en).toBeUndefined();
    expect((await contentWork(ctx.store.id, main, "en", "missing")).find((u) => u.id === unit.id)?.items.some((i) => i.label === "Role")).toBeFalsy();
  });
});
