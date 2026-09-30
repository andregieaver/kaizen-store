import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { PageBlock, PageRow } from "@/lib/page-content";
import { TEMPLATE_MEDIA_MAX } from "@/lib/template-content";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const saved = await import("./saved-parts");
const templates = await import("./templates");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const files = "https://files.example.com/storage/v1/object/public";

/** Accounts and stores: `both` owns pub and mine; `pubOwner` owns pub, works in mine as staff; `other` owns theirs alone. */
let both: Account;
let pubOwner: Account;
let staff: Account;
let other: Account;
let stranger: Account;
let keeper: Account;
let moderator: Account;
let pub: string;
let mine: string;
let theirs: string;

const account = async (name: string, platformAdmin = false): Promise<Account> => {
  const email = `tpl-${name}-${run}@example.com`;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${email}, ${name}, ${platformAdmin}) returning id
  `);
  return { id: String(row.id), email, name, platformAdmin };
};
const store = async (slug: string, name: string): Promise<string> => {
  const [row] = await db().execute<Row>(
    sql`insert into commerce.stores (slug, name) values (${`${slug}-${run}`}, ${name}) returning id`,
  );
  return String(row.id);
};
const member = (storeId: string, who: Account, role: "owner" | "admin") =>
  db().execute(
    sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}::uuid, ${who.id}::uuid, ${role})`,
  );

const text = (id: string, words: string, extra: object = {}) => ({
  id,
  type: "richText",
  doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] },
  ...extra,
});
const block = (name: string, words = "Words", sharing?: string) => ({
  kind: "block",
  name: `${name} ${run}`,
  content: text("b", words),
  ...(sharing ? { sharing } : {}),
});

/** Saves a block for a store and returns its id. */
async function part(owner: string | null, by: Account, name: string, sharing?: string): Promise<string> {
  const result = await saved.createSavedPart(by, owner, block(name, "Words", sharing));
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.id;
}

const ids = async (storeId: string, who: Account, source: "stores" | "marketplace") =>
  (await templates.listTemplates(storeId, who, source))
    .filter((t) => t.name.endsWith(run))
    .map((t) => t.name.replace(` ${run}`, ""));

const audited = async (action: string, storeId: string | null) => {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.audit_log where action = ${action} and store_id is not distinct from ${storeId}::uuid
  `);
  return Number(row.n);
};

beforeAll(async () => {
  [both, pubOwner, staff, other, stranger, keeper, moderator] = await Promise.all([
    account("both"),
    account("pubowner"),
    account("staff"),
    account("other"),
    account("stranger"),
    account("keeper"),
    account("moderator", true),
  ]);
  [pub, mine, theirs] = await Promise.all([
    store("tpl-pub", `Pub Shop ${run}`),
    store("tpl-mine", `Mine ${run}`),
    store("tpl-theirs", `Theirs ${run}`),
  ]);
  await Promise.all([
    member(pub, both, "owner"),
    member(mine, both, "owner"),
    member(pub, pubOwner, "owner"),
    member(mine, pubOwner, "admin"),
    member(pub, staff, "admin"),
    member(mine, staff, "admin"),
    member(theirs, other, "owner"),
    // A store must keep an owner while the tests take one's away.
    member(mine, keeper, "owner"),
  ]);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.saved_parts where name like ${`% ${run}`}`);
  await db().execute(sql`delete from commerce.media where file_name like ${`%${run}%`}`);
  await closeDb();
});

describe("who can share a saved part", () => {
  it("lets owners share and staff keep to private, and makes Kaizen's own the marketplace's", async () => {
    const shared = await saved.createSavedPart(both, pub, block("Owner shares", "Hi", "marketplace"));
    expect(shared.ok && shared.parts.find((p) => p.id === shared.id)?.sharing).toBe("marketplace");
    expect(await saved.createSavedPart(staff, pub, block("Staff shares", "Hi", "stores"))).toEqual({
      ok: false,
      problems: [templates.NOT_OWNER],
    });
    expect(await saved.createSavedPart(staff, pub, block("Staff keeps", "Hi"))).toMatchObject({ ok: true });
    const plain = await saved.listSavedParts(pub);
    expect(plain.find((p) => p.name === `Staff keeps ${run}`)?.sharing).toBe("private");

    // Kaizen's own are the marketplace's whatever the input says.
    const kaizen = await saved.createSavedPart(moderator, null, block("Kaizen own", "Hi", "private"));
    expect(kaizen.ok && kaizen.parts.find((p) => p.id === kaizen.id)?.sharing).toBe("marketplace");
  });

  it("keeps how a part is shared when an update does not say, and lets only an owner change it", async () => {
    const id = await part(pub, both, "Update me", "marketplace");
    const content = text("b", "Changed");
    // Nothing said (the way the builder's dialog saved parts before templates): as it was.
    const same = await saved.updateSavedPart(staff, pub, id, { kind: "block", name: `Update me ${run}`, content });
    expect(same.ok && same.parts.find((p) => p.id === id)?.sharing).toBe("marketplace");
    expect(
      await saved.updateSavedPart(staff, pub, id, {
        kind: "block",
        name: `Update me ${run}`,
        content,
        sharing: "private",
      }),
    ).toEqual({
      ok: false,
      problems: [templates.NOT_OWNER],
    });
    const changed = await saved.updateSavedPart(both, pub, id, {
      kind: "block",
      name: `Update me ${run}`,
      content,
      sharing: "stores",
    });
    expect(changed.ok && changed.parts.find((p) => p.id === id)?.sharing).toBe("stores");
  });

  it("changes it with setPartSharing: owners of the store only, its own parts only, and it writes the audit log", async () => {
    const id = await part(pub, both, "Share me");
    expect(await templates.setPartSharing(pub, staff, id, "marketplace")).toEqual({
      ok: false,
      problems: [templates.NOT_OWNER],
    });
    expect(await templates.setPartSharing(mine, both, id, "marketplace")).toEqual({
      ok: false,
      problems: ["This saved part no longer exists."],
    });
    expect(await templates.setPartSharing(pub, both, id, "everyone" as "private")).toMatchObject({ ok: false });
    const before = await audited("store.part_sharing", pub);
    expect(await templates.setPartSharing(pub, both, id, "marketplace")).toEqual({ ok: true });
    expect(await templates.setPartSharing(pub, both, id, "marketplace")).toEqual({ ok: true });
    expect(await audited("store.part_sharing", pub)).toBe(before + 1);
    expect(await ids(mine, both, "marketplace")).toContain("Share me");
  });
});

describe("which templates a store sees", () => {
  let market: string;

  beforeAll(async () => {
    await part(pub, both, "Vis private");
    await part(pub, both, "Vis stores", "stores");
    market = await part(pub, both, "Vis market", "marketplace");
  });

  it("shows a stores template to an account that owns both stores, and the marketplace's to any member", async () => {
    expect(await ids(mine, both, "stores")).toEqual(expect.arrayContaining(["Vis stores"]));
    expect(await ids(mine, both, "stores")).not.toContain("Vis market");
    expect(await ids(mine, both, "stores")).not.toContain("Vis private");
    expect(await ids(mine, both, "marketplace")).toContain("Vis market");
    expect(await ids(mine, both, "marketplace")).not.toContain("Vis stores");
  });

  it("does not show a stores template to an owner of one store only, to staff or to another account", async () => {
    // Owner of the publishing store but staff in the viewing one.
    expect(await ids(mine, pubOwner, "stores")).toEqual([]);
    expect(await ids(mine, staff, "stores")).toEqual([]);
    expect(await ids(theirs, other, "stores")).toEqual([]);
    // Not a member of the viewing store at all.
    expect(await ids(mine, stranger, "stores")).toEqual([]);
    expect(await ids(mine, stranger, "marketplace")).toEqual([]);
    expect(await ids(mine, other, "marketplace")).toEqual([]);
  });

  it("shows the marketplace to every store's members, with the publisher's name, and never a store its own parts", async () => {
    expect(await ids(mine, staff, "marketplace")).toContain("Vis market");
    expect(await ids(theirs, other, "marketplace")).toContain("Vis market");
    expect(await ids(pub, both, "marketplace")).not.toContain("Vis market");
    expect(await ids(pub, both, "stores")).not.toContain("Vis stores");
    const item = (await templates.listTemplates(theirs, other, "marketplace")).find((t) => t.id === market);
    expect(item).toMatchObject({
      publisher: `Pub Shop ${run}`,
      fromKaizen: false,
      sharing: "marketplace",
      kind: "block",
      summary: "text",
      active: false,
    });
  });

  it("lists newest first", async () => {
    const list = await templates.listTemplates(mine, both, "marketplace");
    const dates = list.map((t) => t.updatedAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("takes a stores template away when it is shared with nobody again, or when ownership is lost", async () => {
    const id = await part(pub, both, "Vis changing", "stores");
    expect(await ids(mine, both, "stores")).toContain("Vis changing");
    await templates.setPartSharing(pub, both, id, "private");
    expect(await ids(mine, both, "stores")).not.toContain("Vis changing");
    await templates.setPartSharing(pub, both, id, "stores");
    expect(await ids(mine, both, "stores")).toContain("Vis changing");

    await db().execute(
      sql`update commerce.store_members set role = 'admin' where store_id = ${mine}::uuid and account_id = ${both.id}::uuid`,
    );
    expect(await ids(mine, both, "stores")).toEqual([]);
    expect(await templates.applyTemplate(mine, both, id)).toMatchObject({ ok: false });
    await db().execute(
      sql`update commerce.store_members set role = 'owner', disabled_at = now() where store_id = ${pub}::uuid and account_id = ${both.id}::uuid`,
    );
    await db().execute(
      sql`update commerce.store_members set role = 'owner' where store_id = ${mine}::uuid and account_id = ${both.id}::uuid`,
    );
    expect(await ids(mine, both, "stores")).toEqual([]);
    await db().execute(
      sql`update commerce.store_members set disabled_at = null where store_id = ${pub}::uuid and account_id = ${both.id}::uuid`,
    );
    expect(await ids(mine, both, "stores")).toContain("Vis changing");
  });

  it("leaves out templates whose content cannot be read", async () => {
    await db().execute(sql`
      insert into commerce.saved_parts (store_id, kind, name, content, sharing)
      values (${pub}::uuid, 'block', ${`Vis broken ${run}`}, '{"type":"nothing"}'::jsonb, 'marketplace')
    `);
    expect(await ids(mine, both, "marketplace")).not.toContain("Vis broken");
  });

  it("does not show a hidden template anywhere, and shows it again when it is unhidden", async () => {
    expect(await templates.setTemplateHidden(both, market, true)).toEqual({
      ok: false,
      problems: ["Only the platform's admins can hide templates."],
    });
    expect(await templates.setTemplateHidden(moderator, market, true)).toEqual({ ok: true });
    expect(await ids(mine, both, "marketplace")).not.toContain("Vis market");
    expect(await ids(theirs, other, "marketplace")).not.toContain("Vis market");
    expect(await templates.setTemplateActive(theirs, other, market, true)).toMatchObject({ ok: false });
    expect(await templates.applyTemplate(theirs, other, market)).toMatchObject({ ok: false });
    // Its publisher taking it back and sharing it again does not lift the hiding.
    await templates.setPartSharing(pub, both, market, "private");
    await templates.setPartSharing(pub, both, market, "marketplace");
    expect(await ids(mine, both, "marketplace")).not.toContain("Vis market");
    expect((await templates.listMarketplaceTemplates()).find((t) => t.id === market)).toMatchObject({
      hidden: true,
      publisher: `Pub Shop ${run}`,
    });
    expect(await audited("platform.template_hidden", pub)).toBeGreaterThan(0);

    expect(await templates.setTemplateHidden(moderator, market, false)).toEqual({ ok: true });
    expect(await ids(mine, both, "marketplace")).toContain("Vis market");
    expect((await templates.listMarketplaceTemplates()).find((t) => t.id === market)).toMatchObject({
      hidden: false,
      hiddenAt: null,
    });
    expect(await audited("platform.template_unhidden", pub)).toBeGreaterThan(0);
    expect(await templates.setTemplateHidden(moderator, "not-an-id", true)).toMatchObject({ ok: false });
  });

  it("lists every marketplace template for moderation, not the private ones", async () => {
    const list = (await templates.listMarketplaceTemplates()).filter((t) => t.name.endsWith(run));
    expect(list.map((t) => t.name.replace(` ${run}`, ""))).toEqual(
      expect.arrayContaining(["Vis market", "Kaizen own"]),
    );
    expect(list.find((t) => t.name.startsWith("Kaizen own"))).toMatchObject({
      publisher: "Kaizen",
      fromKaizen: true,
      storeSlug: null,
    });
    expect(list.map((t) => t.name)).not.toContain(`Vis private ${run}`);
  });
});

describe("switching templates on", () => {
  it("has Kaizen's on until a store switches them off, and every other off until switched on", async () => {
    const kaizenId = await part(null, moderator, "Act kaizen");
    const shared = await part(pub, both, "Act shared", "marketplace");
    const find = async (storeId: string, who: Account, id: string) =>
      (await templates.listTemplates(storeId, who, "marketplace")).find((t) => t.id === id);
    expect(await find(mine, both, kaizenId)).toMatchObject({ active: true, fromKaizen: true, publisher: "Kaizen" });
    expect(await find(mine, both, shared)).toMatchObject({ active: false });

    expect(await templates.setTemplateActive(mine, both, kaizenId, false)).toEqual({ ok: true });
    expect(await templates.setTemplateActive(mine, both, shared, true)).toEqual({ ok: true });
    expect(await find(mine, both, kaizenId)).toMatchObject({ active: false });
    expect(await find(mine, both, shared)).toMatchObject({ active: true });
    // One store's choice is its own.
    expect(await find(theirs, other, kaizenId)).toMatchObject({ active: true });
    expect(await find(theirs, other, shared)).toMatchObject({ active: false });

    // A store made later has Kaizen's on too.
    const later = await store("tpl-later", `Later ${run}`);
    await member(later, both, "owner");
    expect(await find(later, both, kaizenId)).toMatchObject({ active: true });
  });

  it("upserts one row per store and template, records who and when, and audits it", async () => {
    const id = await part(pub, both, "Act upsert", "marketplace");
    const before = await audited("store.template_activated", mine);
    await templates.setTemplateActive(mine, both, id, true);
    await templates.setTemplateActive(mine, staff, id, true);
    await templates.setTemplateActive(mine, staff, id, false);
    await templates.setTemplateActive(mine, both, id, true);
    const rows = await db().execute<Row>(
      sql`select active, changed_by from commerce.template_activations where store_id = ${mine}::uuid and part_id = ${id}::uuid`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ active: true, changed_by: both.id });
    expect(await audited("store.template_activated", mine)).toBe(before + 3);
    expect(await audited("store.template_deactivated", mine)).toBeGreaterThan(0);
  });

  it("only switches on what the store may see", async () => {
    const priv = await part(pub, both, "Act private");
    const ofStores = await part(pub, both, "Act ofstores", "stores");
    expect(await templates.setTemplateActive(mine, both, priv, true)).toEqual({
      ok: false,
      problems: ["This template is not available to your store."],
    });
    expect(await templates.setTemplateActive(theirs, other, ofStores, true)).toMatchObject({ ok: false });
    expect(await templates.setTemplateActive(mine, stranger, ofStores, true)).toMatchObject({ ok: false });
    expect(await templates.setTemplateActive(pub, both, ofStores, true)).toMatchObject({ ok: false });
    expect(await templates.setTemplateActive(mine, both, "nope", true)).toMatchObject({ ok: false });
    expect(await templates.setTemplateActive(mine, both, ofStores, true)).toEqual({ ok: true });
    const [row] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.template_activations where part_id in (${priv}::uuid)`,
    );
    expect(row.n).toBe(0);
  });

  it("takes a template's switches with it when it is deleted", async () => {
    const id = await part(pub, both, "Act delete", "marketplace");
    await templates.setTemplateActive(mine, both, id, true);
    await saved.deleteSavedPart(both, pub, id);
    const [row] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.template_activations where part_id = ${id}::uuid`,
    );
    expect(row.n).toBe(0);
  });
});

describe("using a template", () => {
  /** A stand-in for Storage's copy: where it copied to, and nothing more. */
  const copied: { bucket: string; from: string; to: string }[] = [];
  const copyFile = async (bucket: string, from: string, to: string) => {
    copied.push({ bucket, from, to });
    return `${files}/${bucket}/${to}`;
  };

  const picture = async (
    owner: string | null,
    name: string,
    extra: { bytes?: number; kind?: "image" | "video" } = {},
  ) => {
    const kind = extra.kind ?? "image";
    const path = `${owner ?? "platform"}/${run}-${name}${kind === "image" ? ".webp" : ".mp4"}`;
    const bucket = kind === "image" ? "product-media" : "page-videos";
    await db().execute(sql`
      insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes, width, height)
      values (${owner}::uuid, ${kind}, ${`${files}/${bucket}/${path}`}, ${kind === "image" ? `${files}/${bucket}/${path}-480` : null}, ${bucket}, ${path},
        ${kind === "image" ? `${path}-480` : null}, ${`${name}-${run}`}, ${kind === "image" ? "image/webp" : "video/mp4"}, ${extra.bytes ?? 1000},
        ${kind === "image" ? 800 : null}, ${kind === "image" ? 600 : null})
    `);
    return `${files}/${bucket}/${path}`;
  };
  const image = (id: string, url: string): PageBlock =>
    ({ id, type: "image", image: { url, width: 800, height: 600, alt: "Alt" }, caption: "" }) as PageBlock;

  /** A shared row holding what a store's own things look like. */
  async function shared(name: string, blocks: unknown[], sharing = "marketplace", background?: unknown) {
    const row = {
      id: "row",
      type: "row",
      layout: "1",
      columns: [{ id: "col", blocks, ...(background ? { background } : {}) }],
    };
    const result = await saved.createSavedPart(both, pub, {
      kind: "row",
      name: `${name} ${run}`,
      content: row,
      sharing,
    });
    if (!result.ok) throw new Error(result.problems.join(" "));
    return result.id;
  }
  const used = async (id: string, who: Account = other, storeId = theirs) => {
    const result = await templates.applyTemplate(storeId, who, id, { copyFile });
    if (!result.ok) throw new Error(result.problems.join(" "));
    return result.part;
  };

  it("gives a copy that is not global and is shared with nobody, with the other store's things left out", async () => {
    const own = await picture(pub, "own");
    const id = await shared("Use clean", [
      text("b1", "Read on", {
        global: "22222222-2222-4222-8222-222222222222",
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Read",
                  marks: [{ type: "link", attrs: { href: `/s/tpl-pub-${run}/no/about` } }],
                },
              ],
            },
          ],
        },
      }),
      { id: "b2", type: "button", label: "Buy", href: `/s/tpl-pub-${run}/no/products` },
      { id: "b3", type: "button", label: "Fine", href: "/about" },
      {
        id: "b4",
        type: "emailForm",
        recipients: ["owner@pub.example"],
        subject: "",
        fields: [{ id: "f", kind: "text", label: "Name" }],
        submitLabel: "",
        successMessage: "",
      },
      image("b5", own),
      image("b6", "https://cdn.example.com/free.jpg"),
      { id: "b7", type: "menu", menuId: pub },
    ]);
    const part = await used(id);
    expect(part).toMatchObject({
      id,
      kind: "row",
      global: false,
      sharing: "private",
      translations: {},
      uses: 0,
      name: `Use clean ${run}`,
    });
    const json = JSON.stringify(part.content);
    expect(json).not.toContain(pub);
    expect(json).not.toContain("tpl-pub");
    expect(json).not.toContain("owner@pub.example");
    const blocks = (part.content as PageRow).columns[0].blocks as unknown as Record<string, unknown>[];
    expect(blocks[0].global).toBeUndefined();
    expect(blocks[1].href).toBe("");
    expect(blocks[2].href).toBe("/about");
    expect(blocks[3].recipients).toEqual([]);
    expect(blocks[5]).toMatchObject({ image: { url: "https://cdn.example.com/free.jpg" } });
    expect(blocks[6].menuId).toBeUndefined();
  });

  it("copies a picture into the store's own library and points the copy at it", async () => {
    copied.length = 0;
    const own = await picture(pub, "copy-me");
    const id = await shared("Use media", [image("b1", own)]);
    const part = await used(id);
    const url = ((part.content as PageRow).columns[0].blocks[0] as { image: { url: string } }).image.url;
    expect(url).toContain(`/product-media/${theirs}/`);
    expect(url).not.toContain(pub);
    expect(copied.map((c) => c.from)).toEqual([`${pub}/${run}-copy-me.webp`, `${pub}/${run}-copy-me.webp-480`]);
    expect(copied.every((c) => c.to.startsWith(`${theirs}/`))).toBe(true);
    const [row] = await db().execute<Row>(sql`
      select store_id, thumbnail_url, size_bytes, created_by, kind from commerce.media where url = ${url}
    `);
    expect(row).toMatchObject({ store_id: theirs, size_bytes: "1000", created_by: other.id, kind: "image" });
    expect(String(row.thumbnail_url)).toContain(`${theirs}/`);
    // The template and the publisher's picture are untouched.
    const [source] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.media where url = ${own} and store_id = ${pub}::uuid`,
    );
    expect(source.n).toBe(1);
    expect(await audited("store.template_used", theirs)).toBeGreaterThan(0);
  });

  it("copies backgrounds and videos too, and leaves out what it cannot copy", async () => {
    const bg = await picture(pub, "bg");
    const film = await picture(pub, "film", { kind: "video" });
    const id = await shared(
      "Use backgrounds",
      [
        image("b1", `${files}/product-media/${pub}/not-in-the-library.webp`),
        {
          id: "b2",
          type: "video",
          source: "upload",
          video: { url: film },
          link: "",
          poster: { url: `${files}/product-media/${pub}/no-still.webp`, width: 10, height: 10 },
          title: "",
        },
      ],
      "marketplace",
      { type: "image", image: { url: bg, width: 800, height: 600 }, overlay: null },
    );
    const part = await used(id);
    const column = (part.content as PageRow).columns[0];
    expect(column.background).toMatchObject({ type: "image" });
    expect(JSON.stringify(column.background)).toContain(`/${theirs}/`);
    // Not in the publisher's library: dropped, never left pointing at it.
    expect((column.blocks[0] as { image: unknown }).image).toBeNull();
    const video = column.blocks[1] as { video: { url: string }; poster: unknown };
    expect(video.video.url).toContain(`/page-videos/${theirs}/`);
    expect(video.poster).toBeNull();
    expect(JSON.stringify(part.content)).not.toContain(pub);
  });

  it("does not copy another store's file, even one the template names", async () => {
    const someoneElses = await picture(theirs, "not-yours");
    const id = await shared("Use foreign", [image("b1", someoneElses)]);
    // Used by `mine`: the picture is in a third store's library, not the publisher's.
    const part = await used(id, both, mine);
    expect((part.content as PageRow).columns[0].blocks[0]).toMatchObject({ image: null });
    expect(JSON.stringify(part.content)).not.toContain(theirs);
  });

  it("leaves a picture out when Storage cannot copy it, and keeps no library row for it", async () => {
    const own = await picture(pub, "will-fail");
    const id = await shared("Use failing", [image("b1", own)]);
    const result = await templates.applyTemplate(theirs, other, id, { copyFile: async () => null });
    expect(result.ok && (result.part.content as PageRow).columns[0].blocks[0]).toMatchObject({ image: null });
    const [row] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.media where store_id = ${theirs}::uuid and file_name = ${`will-fail-${run}`}`,
    );
    expect(row.n).toBe(0);
  });

  it("copies at most a set number of files in one use", async () => {
    copied.length = 0;
    const many: PageBlock[] = [];
    for (let i = 0; i < TEMPLATE_MEDIA_MAX + 3; i++) many.push(image(`b${i}`, await picture(pub, `many-${i}`)));
    const id = await shared("Use many", many);
    const part = await used(id);
    const kept = (part.content as PageRow).columns[0].blocks.filter((b) => (b as { image: unknown }).image !== null);
    expect(kept).toHaveLength(TEMPLATE_MEDIA_MAX);
    expect(JSON.stringify(part.content)).not.toContain(pub);
  });

  it("uses Kaizen's own templates the same way, copying its pictures and keeping its HTML", async () => {
    const own = await picture(null, "kaizen-pic");
    const row = {
      id: "row",
      type: "row",
      layout: "1",
      columns: [{ id: "col", blocks: [image("b1", own), { id: "b2", type: "html", html: "<b>Hi</b>", title: "Hi" }] }],
    };
    const made = await saved.createSavedPart(moderator, null, { kind: "row", name: `Use kaizen ${run}`, content: row });
    if (!made.ok) throw new Error("not saved");
    const part = await used(made.id);
    const column = (part.content as PageRow).columns[0];
    expect((column.blocks[0] as { image: { url: string } }).image.url).toContain(`/${theirs}/`);
    expect(column.blocks[1]).toMatchObject({ type: "html", html: "<b>Hi</b>" });
  });

  it("empties another owner's HTML", async () => {
    const id = await shared("Use html", [
      { id: "b1", type: "html", html: "<script>steal()</script>", title: "Widget" },
    ]);
    const part = await used(id);
    expect((part.content as PageRow).columns[0].blocks[0]).toMatchObject({ type: "html", html: "" });
  });

  it("refuses a template the store may not see, and a copy is not changed by what happens to the template", async () => {
    const id = await shared("Use gone", [text("b1", "Original")], "stores");
    expect(await templates.applyTemplate(theirs, other, id, { copyFile })).toEqual({
      ok: false,
      problems: ["This template is not available to your store."],
    });
    const before = await used(id, both, mine);
    await saved.updateSavedPart(both, pub, id, {
      kind: "row",
      name: `Use gone ${run}`,
      content: { id: "row", type: "row", layout: "1", columns: [{ id: "col", blocks: [text("b1", "Changed")] }] },
    });
    await saved.deleteSavedPart(both, pub, id);
    expect(JSON.stringify(before.content)).toContain("Original");
    expect(await templates.applyTemplate(mine, both, id, { copyFile })).toMatchObject({ ok: false });
    expect(await templates.applyTemplate(mine, both, "nope", { copyFile })).toMatchObject({ ok: false });
  });
});

describe("page layouts as templates (D127)", () => {
  const copied: string[] = [];
  const copyFile = async (bucket: string, from: string, to: string) => {
    copied.push(from);
    return `${files}/${bucket}/${to}`;
  };
  const picture = async (owner: string, name: string) => {
    const path = `${owner}/${run}-${name}.webp`;
    await db().execute(sql`
      insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes, width, height)
      values (${owner}::uuid, 'image', ${`${files}/product-media/${path}`}, ${`${files}/product-media/${path}-480`}, 'product-media', ${path},
        ${`${path}-480`}, ${`${name}-${run}`}, 'image/webp', 1000, 800, 600)
    `);
    return `${files}/product-media/${path}`;
  };
  const image = (id: string, url: string) =>
    ({ id, type: "image", image: { url, width: 800, height: 600, alt: "Alt" }, caption: "" }) as unknown as PageBlock;
  const rowOf = (id: string, blocks: unknown[], extra: object = {}) =>
    ({ id, type: "row", layout: "1", columns: [{ id: `${id}-col`, blocks }], ...extra }) as unknown as PageRow;
  const layoutOf = (pageType: string, rows: PageRow[], css = "") => ({ pageType, rows, css });

  async function layout(name: string, content: ReturnType<typeof layoutOf>, sharing = "marketplace", by = both) {
    const result = await saved.createSavedPart(by, pub, { kind: "page", name: `${name} ${run}`, content, sharing });
    if (!result.ok) throw new Error(result.problems.join(" "));
    return result.id;
  }
  it("keeps a page layout as a saved part of its own: never global, no marks, sharing as for the rest", async () => {
    const marked = rowOf("r1", [text("b1", "Hi")], { global: "22222222-2222-4222-8222-222222222222" });
    const id = await layout("PL keep", layoutOf("page", [marked], ".a { color: red; }"), "private");
    const list = await saved.listSavedParts(pub);
    const part = list.find((p) => p.id === id);
    expect(part).toMatchObject({ kind: "page", global: false, sharing: "private", translations: {}, uses: 0 });
    expect(part?.kind === "page" && part.content).toMatchObject({ pageType: "page", css: ".a { color: red; }" });
    expect(part?.kind === "page" && part.content.rows[0].global).toBeUndefined();

    const global = await saved.createSavedPart(both, pub, {
      kind: "page",
      name: `PL global ${run}`,
      content: layoutOf("page", [rowOf("r1", [text("b1", "Hi")])]),
      global: true,
    });
    expect(global).toMatchObject({ ok: false });
    expect(
      await saved.createSavedPart(staff, pub, {
        kind: "page",
        name: `PL staff ${run}`,
        content: layoutOf("page", [rowOf("r1", [text("b1", "Hi")])]),
        sharing: "stores",
      }),
    ).toEqual({ ok: false, problems: [templates.NOT_OWNER] });
    // Bad CSS is refused, as on a page.
    expect(
      await saved.createSavedPart(both, pub, {
        kind: "page",
        name: `PL css ${run}`,
        content: layoutOf("page", [rowOf("r1", [text("b1", "Hi")])], "@import url(https://x.example/a.css);"),
      }),
    ).toMatchObject({ ok: false });
  });

  it("updates and deletes a page layout, and only an owner changes how it is shared", async () => {
    const id = await layout("PL update", layoutOf("article", [rowOf("r1", [text("b1", "One")])]), "private");
    const input = (words: string, extra: object = {}) => ({
      kind: "page",
      name: `PL update ${run}`,
      content: layoutOf("article", [rowOf("r1", [text("b1", words)])]),
      ...extra,
    });
    const same = await saved.updateSavedPart(staff, pub, id, input("Two"));
    expect(same.ok && JSON.stringify(same.parts.find((p) => p.id === id)?.content)).toContain("Two");
    expect(await saved.updateSavedPart(staff, pub, id, input("Two", { sharing: "marketplace" }))).toEqual({
      ok: false,
      problems: [templates.NOT_OWNER],
    });
    expect(await saved.updateSavedPart(both, pub, id, input("Three", { global: true }))).toMatchObject({ ok: false });
    expect(await saved.updateSavedPart(both, pub, id, input("Three", { sharing: "marketplace" }))).toMatchObject({
      ok: true,
    });
    // The kind stays: a row cannot overwrite it, and another store cannot touch it.
    expect(
      await saved.updateSavedPart(both, pub, id, {
        kind: "row",
        name: `x ${run}`,
        content: rowOf("r1", [text("b1", "x")]),
      }),
    ).toMatchObject({ ok: false });
    expect(await saved.updateSavedPart(both, mine, id, input("Hijack"))).toMatchObject({ ok: false });
    const removed = await saved.deleteSavedPart(both, pub, id);
    expect(removed.ok && removed.parts.find((p) => p.id === id)).toBeUndefined();
    expect((await saved.listSavedParts(pub)).some((p) => p.id === id)).toBe(false);
  });

  it("lists page layouts with the kind of page they are for, and null for the others", async () => {
    const header = await layout(
      "PL list header",
      layoutOf("header", [rowOf("r1", [{ id: "s1", type: "site", part: "logo" }]), rowOf("r2", [text("b2", "Menu")])]),
    );
    const plain = await part(pub, both, "PL list block", "marketplace");
    const list = await templates.listTemplates(mine, both, "marketplace");
    expect(list.find((t) => t.id === header)).toMatchObject({
      kind: "page",
      pageType: "header",
      summary: "2 rows: site part, text",
      publisher: `Pub Shop ${run}`,
      active: false,
    });
    expect(list.find((t) => t.id === plain)).toMatchObject({ kind: "block", pageType: null });
  });

  it("shares page layouts like the others: marketplace to every member, stores to owners of both, never private or hidden", async () => {
    const one = layoutOf("page", [rowOf("r1", [text("b1", "Hi")])]);
    const market = await layout("PL vis market", one, "marketplace");
    const stores = await layout("PL vis stores", one, "stores");
    await layout("PL vis private", one, "private");
    expect(await ids(theirs, other, "marketplace")).toContain("PL vis market");
    expect(await ids(theirs, other, "marketplace")).not.toContain("PL vis stores");
    expect(await ids(mine, both, "stores")).toEqual(expect.arrayContaining(["PL vis stores"]));
    expect(await ids(mine, both, "stores")).not.toContain("PL vis private");
    expect(await ids(mine, staff, "stores")).toEqual([]);
    expect(await ids(pub, both, "marketplace")).not.toContain("PL vis market");

    expect(await templates.setTemplateHidden(moderator, market, true)).toEqual({ ok: true });
    expect(await ids(theirs, other, "marketplace")).not.toContain("PL vis market");
    expect(await templates.applyTemplate(theirs, other, market)).toMatchObject({ ok: false });
    expect(await templates.previewTemplate(theirs, other, market)).toMatchObject({ ok: false });
    expect((await templates.listMarketplaceTemplates()).find((t) => t.id === market)).toMatchObject({
      kind: "page",
      pageType: "page",
      hidden: true,
    });
    await templates.setTemplateHidden(moderator, market, false);
    expect(await ids(theirs, other, "marketplace")).toContain("PL vis market");
    expect((await templates.listMarketplaceTemplates()).find((t) => t.id === stores)).toBeUndefined();
  });

  it("switches page layouts on and off for a store like the other templates", async () => {
    const id = await layout("PL act", layoutOf("footer", [rowOf("r1", [text("b1", "Hi")])]));
    const find = async () => (await templates.listTemplates(theirs, other, "marketplace")).find((t) => t.id === id);
    expect(await find()).toMatchObject({ active: false, kind: "page", pageType: "footer" });
    expect(await templates.setTemplateActive(theirs, other, id, true)).toEqual({ ok: true });
    expect(await find()).toMatchObject({ active: true });
    expect(await templates.setTemplateActive(theirs, other, id, false)).toEqual({ ok: true });
    expect(await find()).toMatchObject({ active: false });
    expect(await templates.setTemplateActive(pub, both, id, true)).toMatchObject({ ok: false });
  });

  it("uses a page layout: pictures of every row are copied within the caps, the rest cleaned, CSS kept when clean", async () => {
    copied.length = 0;
    const first = await picture(pub, "pl-first");
    const second = await picture(pub, "pl-second");
    const bg = await picture(pub, "pl-bg");
    const id = await layout(
      "PL use",
      layoutOf(
        "page",
        [
          rowOf("r1", [
            image("b1", first),
            { id: "b2", type: "button", label: "Buy", href: `/s/tpl-pub-${run}/no/products` },
          ]),
          rowOf(
            "r2",
            [
              image("b3", second),
              {
                id: "b4",
                type: "emailForm",
                recipients: ["o@pub.example"],
                subject: "",
                fields: [],
                submitLabel: "",
                successMessage: "",
              },
            ],
            {
              background: { type: "image", image: { url: bg, width: 800, height: 600 }, overlay: null },
            },
          ),
        ],
        ".hero { color: red; }",
      ),
    );
    const result = await templates.applyTemplate(theirs, other, id, { copyFile });
    if (!result.ok || result.part.kind !== "page") throw new Error("not used");
    const content = result.part.content;
    expect(result.part).toMatchObject({ id, global: false, sharing: "private", uses: 0 });
    expect(content.pageType).toBe("page");
    expect(content.css).toBe(".hero { color: red; }");
    const json = JSON.stringify(content);
    expect(json).not.toContain(pub);
    expect(json).not.toContain("tpl-pub");
    expect(json).not.toContain("o@pub.example");
    expect(json.match(new RegExp(`/product-media/${theirs}/`, "g"))).toHaveLength(3);
    expect(new Set(copied.filter((c) => !c.endsWith("-480")))).toEqual(
      new Set([`${pub}/${run}-pl-first.webp`, `${pub}/${run}-pl-second.webp`, `${pub}/${run}-pl-bg.webp`]),
    );
    expect((content.rows[0].columns[0].blocks[1] as { href: string }).href).toBe("");
  });
});

describe("previewing a template (D127)", () => {
  const image = (id: string, url: string) =>
    ({ id, type: "image", image: { url, width: 800, height: 600, alt: "Alt" }, caption: "" }) as unknown as PageBlock;
  const rowOf = (id: string, blocks: unknown[]) =>
    ({ id, type: "row", layout: "1", columns: [{ id: `${id}-col`, blocks }] }) as unknown as PageRow;
  const make = async (name: string, input: Record<string, unknown>, sharing = "marketplace") => {
    const result = await saved.createSavedPart(both, pub, { name: `${name} ${run}`, sharing, ...input });
    if (!result.ok) throw new Error(result.problems.join(" "));
    return result.id;
  };
  const preview = async (storeId: string, who: Account, id: string) => {
    const result = await templates.previewTemplate(storeId, who, id);
    if (!result.ok) throw new Error(result.problems.join(" "));
    return result.preview;
  };
  const counts = async () => {
    const [media] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.media where store_id = ${theirs}::uuid`,
    );
    const [log] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.audit_log where store_id = ${theirs}::uuid or store_id = ${mine}::uuid`,
    );
    return [Number(media.n), Number(log.n)];
  };

  it("draws a page layout as its rows and CSS, cleaned as a use would, and writes nothing", async () => {
    const path = `${pub}/${run}-pv-pic.webp`;
    const url = `${files}/product-media/${path}`;
    await db().execute(sql`
      insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes)
      values (${pub}::uuid, 'image', ${url}, 'product-media', ${path}, ${`pv-pic-${run}`}, 'image/webp', 1000)
    `);
    const id = await make("PV layout", {
      kind: "page",
      content: {
        pageType: "header",
        css: ".a { color: blue; }",
        rows: [
          rowOf("r1", [{ id: "s1", type: "site", part: "logo" }, image("b1", url)]),
          rowOf("r2", [
            { id: "b2", type: "button", label: "Go", href: `/s/tpl-pub-${run}/no/x` },
            {
              id: "b3",
              type: "emailForm",
              recipients: ["o@pub.example"],
              subject: "",
              fields: [],
              submitLabel: "",
              successMessage: "",
            },
          ]),
        ],
      },
    });
    const before = await counts();
    const view = await preview(theirs, other, id);
    expect(view).toMatchObject({
      id,
      kind: "page",
      name: `PV layout ${run}`,
      publisher: `Pub Shop ${run}`,
      fromKaizen: false,
      pageType: "header",
      css: ".a { color: blue; }",
      summary: "2 rows: site part, picture, button, email form",
    });
    expect(view.rows.map((r) => r.id)).toEqual(["r1", "r2"]);
    const json = JSON.stringify(view.rows);
    expect(json).not.toContain("tpl-pub");
    expect(json).not.toContain("o@pub.example");
    // View-only: the picture is still the publisher's, and nothing was copied, written or audited.
    expect(json).toContain(url);
    expect(await counts()).toEqual(before);
  });

  it("wraps a row, column or component in rows, with ids that stay unique", async () => {
    const row = await make("PV row", { kind: "row", content: rowOf("rw", [text("b1", "Hi")]) });
    const column = await make("PV column", {
      kind: "column",
      content: { id: "cl", blocks: [text("b1", "Hi"), text("b2", "There")] },
    });
    const block = await make("PV block", { kind: "block", content: text("b1", "Hi") });
    const r = await preview(theirs, other, row);
    expect(r).toMatchObject({ kind: "row", pageType: null, css: "" });
    expect(r.rows.map((x) => x.id)).toEqual(["rw"]);
    const c = await preview(theirs, other, column);
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].columns.map((x) => x.id)).toEqual(["cl"]);
    expect(c.rows[0].columns[0].blocks).toHaveLength(2);
    const b = await preview(theirs, other, block);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0].columns).toHaveLength(1);
    expect(b.rows[0].columns[0].blocks.map((x) => x.id)).toEqual(["b1"]);
    for (const view of [r, c, b]) {
      const all = view.rows.flatMap((x) => [x.id, ...x.columns.flatMap((y) => [y.id, ...y.blocks.map((z) => z.id)])]);
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it("names Kaizen as the publisher of its own templates, and keeps its HTML", async () => {
    const made = await saved.createSavedPart(moderator, null, {
      kind: "block",
      name: `PV kaizen ${run}`,
      content: { id: "b1", type: "html", html: "<b>Hi</b>", title: "Hi" },
    });
    if (!made.ok) throw new Error("not saved");
    const view = await preview(theirs, other, made.id);
    expect(view).toMatchObject({ publisher: "Kaizen", fromKaizen: true });
    expect(view.rows[0].columns[0].blocks[0]).toMatchObject({ html: "<b>Hi</b>" });
  });

  it("is unavailable exactly when a use would be: own store, private, hidden, not a member, unknown", async () => {
    const one = { kind: "block", content: text("b1", "Hi") };
    const market = await make("PV a market", one);
    const stores = await make("PV a stores", one, "stores");
    const priv = await make("PV a private", one, "private");
    const unavailable = { ok: false, problems: ["This template is not available to your store."] };
    expect(await templates.previewTemplate(theirs, other, market)).toMatchObject({ ok: true });
    expect(await templates.previewTemplate(pub, both, market)).toEqual(unavailable);
    expect(await templates.previewTemplate(theirs, other, priv)).toEqual(unavailable);
    expect(await templates.previewTemplate(mine, both, priv)).toEqual(unavailable);
    expect(await templates.previewTemplate(theirs, other, stores)).toEqual(unavailable);
    expect(await templates.previewTemplate(mine, both, stores)).toMatchObject({ ok: true });
    expect(await templates.previewTemplate(mine, pubOwner, stores)).toEqual(unavailable);
    expect(await templates.previewTemplate(mine, stranger, market)).toEqual(unavailable);
    expect(await templates.previewTemplate(theirs, other, "nope")).toEqual(unavailable);
    // A template that cannot be read is not shown either.
    const [broken] = await db().execute<Row>(sql`
      insert into commerce.saved_parts (store_id, kind, name, content, sharing)
      values (${pub}::uuid, 'page', ${`PV broken ${run}`}, '{"pageType":"nope"}'::jsonb, 'marketplace') returning id
    `);
    expect(await templates.previewTemplate(theirs, other, String(broken.id))).toMatchObject({ ok: false });
  });
});
