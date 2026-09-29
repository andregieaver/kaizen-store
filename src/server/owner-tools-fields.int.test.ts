import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newField } from "@/lib/custom-fields";

import type { AiConnection } from "./ai";
import type { Membership } from "./auth";
import type { Approval, AssistantEvent } from "./owner-assistant";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));

const assistant = await import("./owner-assistant");
const ownerTools = await import("./owner-tools");
const fields = await import("./custom-fields");
const stores = await import("./stores");
const mcp = await import("./store-mcp");

type Row = Record<string, unknown>;

/**
 * The AI manager's custom-fields tools (D118): a group made, a product's
 * values set through the approval gate, read back, and the refusals: claims
 * before anything is kept, and the field types only the admin editor fills in.
 */

const run = Date.now().toString(36);
let member: Membership;
let productId: string;
let productHandle: string;
let pageId: string;
const tags: string[] = [];
const ctx = () => ({ account: member.account, store: member.store, invalidate: (tag: string) => void tags.push(tag) });

const connection = {
  provider: "openai",
  apiUrl: "https://ai.example/v1",
  apiKey: "sk-test",
  textModel: "text-model",
  textEuOnly: false,
  zeroDataRetention: false,
} as unknown as AiConnection;

beforeAll(async () => {
  const name = `tools-fields-${run}`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Kaffe', null)`);
  const store = (await stores.getStore(name))!;
  const [account] = await db().execute<Row>(
    sql`select id, email from commerce.accounts where email = ${`${name}@example.com`}`,
  );
  member = {
    account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false },
    store,
    role: "owner",
  };
  const [product] = await db().execute<Row>(sql`
    select id, handle from commerce.products where store_id = ${store.id}::uuid and status = 'active' order by handle limit 1
  `);
  productId = String(product.id);
  productHandle = String(product.handle);
  const [page] = await db().execute<Row>(sql`
    insert into commerce.pages (store_id, type, slug, draft) values (${store.id}::uuid, 'page', 'fields-page', '{"title": "Feltside", "categories": [], "tags": []}') returning id
  `);
  pageId = String(page.id);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  // What this test made: values, groups, the page, the conversation and its kept calls.
  const id = member.store.id;
  await db().execute(sql`delete from commerce.field_values where store_id = ${id}::uuid`);
  await db().execute(sql`delete from commerce.field_groups where store_id = ${id}::uuid`);
  await db().execute(sql`delete from commerce.pages where store_id = ${id}::uuid and id = ${pageId}::uuid`);
  await db().execute(sql`delete from commerce.assistant_approvals where store_id = ${id}::uuid`);
  await db().execute(sql`delete from commerce.assistant_conversations where store_id = ${id}::uuid`);
  await closeDb();
});

/** A provider answering in the stream format: text in pieces, or tool calls. */
const sse = (chunks: unknown[]) =>
  new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
const says = (text: string) =>
  sse(text.match(/[\s\S]{1,7}/g)!.map((piece) => ({ choices: [{ delta: { content: piece } }] })));
const calls = (...tools: { name: string; args: unknown }[]) =>
  sse(
    tools.map((tool, index) => ({
      choices: [
        {
          delta: {
            tool_calls: [
              { index, id: `call-${index}`, function: { name: tool.name, arguments: JSON.stringify(tool.args) } },
            ],
          },
        },
      ],
    })),
  );

function fakeModel(...answers: Response[]) {
  const requests: { messages: { role: string; content: string | null }[] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return answers.shift() ?? says("(no more answers)");
    }),
  );
  return requests;
}

async function turn(message: string, conversationId: string | null = null) {
  const events: AssistantEvent[] = [];
  await assistant.runTurn({
    member,
    conversationId,
    message,
    emit: (e) => events.push(e),
    invalidate: (tag) => void tags.push(tag),
    connection,
  });
  return events;
}

/** The call kept for approval in a turn, decided as the owner would. */
async function keptAndApproved(tool: string, args: unknown, conversationId: string | null = null) {
  fakeModel(calls({ name: tool, args }), says("Venter på at du godkjenner."));
  const events = await turn(`Gjør ${tool}`, conversationId);
  const queued = (events.find((e) => e.type === "approval") as { approval: Approval } | undefined)?.approval;
  expect(queued, tool).toMatchObject({ tool, category: "public", status: "pending" });
  return { queued: queued!, events };
}

describe("custom fields in the AI manager (D118)", () => {
  let conversationId: string;

  it("starts with no groups", async () => {
    expect(await ownerTools.runOwnerTool(ctx(), "list_field_groups", {})).toMatchObject({
      groups: [],
      note: expect.stringContaining("create_field_group"),
    });
    expect(
      await ownerTools.runOwnerTool(ctx(), "get_fields", { entity: "product", item: productHandle }),
    ).toMatchObject({ groups: [], note: expect.stringContaining("No custom fields apply") });
  });

  it("makes a group through the approval gate, private unless said", async () => {
    const before = tags.length;
    const { queued, events } = await keptAndApproved("create_field_group", {
      name: "Specifications",
      entity: "product",
      fields: [
        { label: "Material", type: "text", access: "public" },
        { label: "Weight", type: "measurement", units: ["g", "kg"], access: "public" },
        { label: "Finish", type: "select", options: ["Matte", "Glossy"], access: "public" },
        { label: "Dishwasher safe", type: "boolean" },
        { label: "Features", type: "checkbox", options: ["Stackable", "Microwave safe"] },
        { label: "Story", type: "richText", access: "public" },
      ],
    });
    conversationId = (events.find((e) => e.type === "conversation") as { id: string }).id;
    expect(queued.summary).toBe(
      'Create the custom field group "Specifications" for products: Material (text, shown on the site), Weight (measurement, shown on the site), Finish (select, shown on the site), Dishwasher safe (boolean), Features (checkbox), Story (richText, shown on the site).',
    );
    // Kept, not made.
    expect(await fields.listFieldGroups(member.store.id)).toEqual([]);

    const decided = await assistant.decideApproval(member, queued.id, true, (tag) => void tags.push(tag));
    expect(decided).toMatchObject({
      status: "done",
      outcome: expect.stringContaining('The field group "Specifications" is made for products'),
    });
    expect(tags.slice(before)).toContain(`fields:${member.store.id}`);

    const listed = (await ownerTools.runOwnerTool(ctx(), "list_field_groups", {})) as {
      groups: Record<string, unknown>[];
    };
    expect(listed.groups).toHaveLength(1);
    expect(listed.groups[0]).toMatchObject({
      name: "Specifications",
      slug: "specifications",
      on: ["products"],
      applies_to: "all of them",
      active: true,
    });
    const list = listed.groups[0].fields as Record<string, unknown>[];
    expect(list.map((f) => f.name)).toEqual(["material", "weight", "finish", "dishwasher_safe", "features", "story"]);
    expect(list.find((f) => f.name === "dishwasher_safe")).toMatchObject({
      type: "boolean",
      access: "private (staff only)",
    });
    expect(list.find((f) => f.name === "finish")).toMatchObject({
      options: ["Matte", "Glossy"],
      access: "public (shown on the site)",
    });
    const [audited] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.audit_log where store_id = ${member.store.id}::uuid and action in ('store.assistant.create_field_group', 'field_group.created')
    `);
    expect(audited.n).toBe(2);
  });

  it("keeps a product's values for the owner's yes, then writes them in the main language and reads them back", async () => {
    const args = {
      entity: "product",
      item: productHandle,
      values: {
        material: "Stoneware from Bergen",
        weight: "300 g",
        finish: "matte",
        dishwasher_safe: "yes",
        features: ["stackable", "Microwave safe"],
        story: "Made by hand.\n\nFired twice.",
      },
    };
    const before = tags.length;
    const { queued } = await keptAndApproved("set_fields", args, conversationId);
    expect(queued.summary).toContain(
      `Set the custom fields of the product "${productHandle}": material = "Stoneware from Bergen"; weight = "300 g"`,
    );
    // Nothing is written until the yes.
    expect(await fields.getFieldData(member.store.id, "product", productId)).toEqual({ values: {}, translations: {} });

    const decided = await assistant.decideApproval(member, queued.id, true, (tag) => void tags.push(tag));
    expect(decided).toMatchObject({
      status: "done",
      outcome: expect.stringMatching(/^Set Material, Weight, Finish, Dishwasher safe, Features, Story on /),
    });
    expect(tags.slice(before)).toEqual(
      expect.arrayContaining([`fields:${member.store.id}`, `catalog:${member.store.id}`]),
    );
    // Once.
    expect(await assistant.decideApproval(member, queued.id, true, () => {})).toBeNull();
    const [logged] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.audit_log where store_id = ${member.store.id}::uuid and action = 'store.assistant.set_fields'
    `);
    expect(logged.n).toBe(1);

    // Text under the main language; choices as their keys, the rest the same in every language.
    const main = member.store.localization.locales[0];
    const data = await fields.getFieldData(member.store.id, "product", productId);
    const groups = await fields.listFieldGroups(member.store.id);
    const id = (name: string) => groups[0].fields.find((f) => f.name === name)!.id;
    expect(data.translations[main][id("material")]).toBe("Stoneware from Bergen");
    expect(data.values[id("finish")]).toBe("matte");
    expect(data.values[id("dishwasher_safe")]).toBe(true);
    expect(data.values[id("features")]).toEqual(["stackable", "microwave-safe"]);
    expect(data.values[id("weight")]).toEqual({ value: 300, unit: "g" });

    const read = (await ownerTools.runOwnerTool(ctx(), "get_fields", { entity: "product", item: productHandle })) as {
      groups: { group: string; fields: { name: string; value: string | null; access: string }[] }[];
    };
    const value = (name: string) => read.groups[0].fields.find((f) => f.name === name)?.value;
    expect(read.groups[0].group).toBe("Specifications");
    expect(value("material")).toBe("Stoneware from Bergen");
    expect(value("weight")).toBe("300 g");
    expect(value("finish")).toBe("Matte");
    expect(value("features")).toBe("Stackable, Microwave safe");
    expect(value("story")).toBe("Made by hand.\nFired twice.");
    expect(value("dishwasher_safe")).toEqual(expect.any(String));

    // A change on top keeps the rest, and null clears.
    expect(
      await ownerTools.runOwnerTool(ctx(), "set_fields", {
        entity: "product",
        item: productHandle,
        values: { material: "Porcelain", finish: null },
      }),
    ).toMatchObject({
      done: expect.stringMatching(/^Set Material and cleared Finish on /),
      on_the_site: ["Material", "Finish"],
    });
    const after = (await ownerTools.runOwnerTool(ctx(), "get_fields", {
      entity: "product",
      item: productHandle,
    })) as typeof read;
    expect(after.groups[0].fields.find((f) => f.name === "material")?.value).toBe("Porcelain");
    expect(after.groups[0].fields.find((f) => f.name === "finish")?.value).toBeNull();
    expect(after.groups[0].fields.find((f) => f.name === "weight")?.value).toBe("300 g");
    // A private field is said to be private.
    expect(
      await ownerTools.runOwnerTool(ctx(), "set_fields", {
        entity: "product",
        item: productHandle,
        values: { Features: ["Stackable"] },
      }),
    ).toMatchObject({ private_so_not_shown: ["Features"] });
  });

  it("refuses text with claims before it is even kept, and keeps nothing", async () => {
    const requests = fakeModel(
      calls({
        name: "set_fields",
        args: { entity: "product", item: productHandle, values: { material: "Eco-friendly stoneware, best price" } },
      }),
      says("Jeg må skrive det om."),
    );
    const events = await turn("Sett materialet", conversationId);
    expect(events.some((e) => e.type === "approval")).toBe(false);
    expect(requests[1].messages.at(-1)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("Rewrite without claims the store cannot back: Eco-friendly"),
    });
    const [waiting] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.assistant_approvals where store_id = ${member.store.id}::uuid and status = 'pending'`,
    );
    expect(waiting.n).toBe(0);
    // The same before the store's MCP server keeps it, and if it were run anyway.
    await expect(
      ownerTools.preflightOwnerTool(ctx(), "set_fields", {
        entity: "product",
        item: productHandle,
        values: { story: "Only 3 left!" },
      }),
    ).rejects.toThrow("Rewrite without claims");
    await expect(
      ownerTools.runOwnerTool(ctx(), "set_fields", {
        entity: "product",
        item: productHandle,
        values: { material: "Climate neutral" },
      }),
    ).rejects.toThrow("Rewrite without claims");
    await expect(
      ownerTools.preflightOwnerTool(ctx(), "create_field_group", {
        name: "Sustainable extras",
        fields: [{ label: "Notes" }],
      }),
    ).rejects.toThrow("Rewrite without claims");
    // Not text a person reads: a choice may be worded as the owner made it.
    await expect(
      ownerTools.preflightOwnerTool(ctx(), "set_fields", {
        entity: "product",
        item: productHandle,
        values: { finish: "Matte" },
      }),
    ).resolves.toBeUndefined();
    const data = (await ownerTools.runOwnerTool(ctx(), "get_fields", { entity: "product", item: productHandle })) as {
      groups: { fields: { name: string; value: string }[] }[];
    };
    expect(data.groups[0].fields.find((f) => f.name === "material")?.value).toBe("Porcelain");
  });

  it("says what is wrong with names, choices and values, all at once", async () => {
    const set = (values: Record<string, unknown>, item = productHandle) =>
      ownerTools.runOwnerTool(ctx(), "set_fields", { entity: "product", item, values });
    await expect(set({ colour: "red" })).rejects.toThrow(
      'There is no field "colour" on this. Its fields: material, weight, finish',
    );
    await expect(set({ finish: "Rough", weight: "heavy" })).rejects.toThrow(
      /"Rough" is not one of the choices: Matte, Glossy\./,
    );
    await expect(set({ weight: "3 tons" })).rejects.toThrow("Choose one of the units");
    await expect(set({})).rejects.toThrow("Name at least one field");
    await expect(set({ material: "x" }, "no-such-product")).rejects.toThrow("No product");
    await expect(
      ownerTools.runOwnerTool(ctx(), "get_fields", { entity: "page", item: "no-such-page" }),
    ).rejects.toThrow('No page "no-such-page"');
    // Another store's product is not reachable.
    const [foreign] = await db().execute<Row>(
      sql`select id from commerce.products where store_id <> ${member.store.id}::uuid limit 1`,
    );
    await expect(set({ material: "x" }, String(foreign.id))).rejects.toThrow("No product");
  });

  it("refuses the field types only the admin editor fills in, and does not make them either", async () => {
    const image = { ...newField("image", []), name: "photo", label: "Photo" };
    const repeater = { ...newField("repeater", ["photo"]), name: "steps", label: "Steps" };
    const saved = await fields.saveFieldGroup(member, {
      id: null,
      name: "Media",
      slug: "media",
      entities: ["product"],
      location: [],
      fields: [image, repeater],
      position: "main",
      active: true,
    });
    expect(saved.ok).toBe(true);
    await expect(
      ownerTools.runOwnerTool(ctx(), "set_fields", {
        entity: "product",
        item: productHandle,
        values: { photo: "https://x.example/a.jpg" },
      }),
    ).rejects.toThrow(
      `Photo is a "image" field, which cannot be filled in from here: use the product's editor (/admin/${member.store.slug}/products/${productId})`,
    );
    await expect(
      ownerTools.runOwnerTool(ctx(), "set_fields", {
        entity: "product",
        item: productHandle,
        values: { steps: "one" },
      }),
    ).rejects.toThrow('"repeater" field');
    // They are read, though: a repeater says it is one.
    const read = (await ownerTools.runOwnerTool(ctx(), "get_fields", { entity: "product", item: productHandle })) as {
      groups: { group: string; fields: { name: string; type: string }[] }[];
    };
    expect(read.groups.find((g) => g.group === "Media")!.fields.map((f) => f.type)).toEqual(["image", "repeater"]);
    // A group is not made with them: the arguments are refused before anything is kept.
    fakeModel(
      calls({ name: "create_field_group", args: { name: "More", fields: [{ label: "Pic", type: "image" }] } }),
      says("Det går ikke."),
    );
    const events = await turn("Lag en gruppe med bilde", conversationId);
    expect(events.some((e) => e.type === "approval")).toBe(false);
    // Options for a choice are needed.
    await expect(
      ownerTools.runOwnerTool(ctx(), "create_field_group", {
        name: "More",
        fields: [{ label: "Pick", type: "select" }],
      }),
    ).rejects.toThrow("give its options");
  });

  it("fills in a page's fields, and the group's own name gets a free web name", async () => {
    const made = (await ownerTools.runOwnerTool(ctx(), "create_field_group", {
      name: "Specifications",
      entity: "page",
      fields: [
        { label: "Author", access: "public" },
        { label: "Reading time", type: "number" },
      ],
    })) as { admin: string };
    expect(made.admin).toMatch(/\/fields\//);
    const groups = await fields.listFieldGroups(member.store.id);
    expect(groups.map((g) => g.slug)).toContain("specifications-2");
    const done = await ownerTools.runOwnerTool(ctx(), "set_fields", {
      entity: "page",
      item: "fields-page",
      values: { author: "Kari", reading_time: "4" },
    });
    expect(done).toMatchObject({ done: expect.stringContaining("on Feltside."), on_the_site: ["Author"] });
    expect(tags).toContain(`pages:${member.store.id}`);
    const read = (await ownerTools.runOwnerTool(ctx(), "get_fields", { entity: "page", item: pageId })) as {
      page: string;
      groups: { fields: { name: string; value: string | null }[] }[];
    };
    expect(read.page).toBe("Feltside");
    expect(read.groups[0].fields.map((f) => f.value)).toEqual(["Kari", "4"]);
    // A product's fields are not a page's.
    await expect(
      ownerTools.runOwnerTool(ctx(), "set_fields", { entity: "page", item: "fields-page", values: { material: "x" } }),
    ).rejects.toThrow('There is no field "material"');
  });

  it("is kept for approval when Kaizen Life asks, after the same checks", async () => {
    const owner = {
      account: member.account,
      stores: [{ id: member.store.id, slug: member.store.slug, name: member.store.name }],
    };
    const bad = await mcp.callMcpTool(
      owner,
      "set_fields",
      { store: member.store.slug, entity: "product", item: productHandle, values: { material: "The best price ever" } },
      () => {},
    );
    expect(bad).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("Rewrite without claims") }],
    });
    const kept = await mcp.callMcpTool(
      owner,
      "set_fields",
      { store: member.store.slug, entity: "product", item: productHandle, values: { material: "Stoneware" } },
      () => {},
    );
    expect(JSON.parse(kept.content[0].text)).toMatchObject({
      kept_for_approval: true,
      what: expect.stringContaining("Set the custom fields of the product"),
    });
    expect(mcp.MCP_TOOLS.find((t) => t.name === "set_fields")).toMatchObject({
      description: expect.stringContaining("kept for the owner to approve"),
    });
    expect(mcp.MCP_TOOLS.find((t) => t.name === "get_fields")?.inputSchema).toMatchObject({
      // The item is left out for the store itself (D120).
      required: ["store", "entity"],
    });
    expect(mcp.MCP_TOOLS.find((t) => t.name === "list_field_groups")).toBeTruthy();
  });
});
