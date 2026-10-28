import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { FEATURE_IDS } from "@/lib/store-features";
import { approvalSummary, OWNER_TOOLS, toolDefinition } from "@/lib/owner-tools";

import type { AiConnection } from "./ai";
import type { Membership } from "./auth";
import type { Approval, AssistantEvent } from "./owner-assistant";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const assistant = await import("./owner-assistant");
const ownerTools = await import("./owner-tools");
const stores = await import("./stores");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let member: Membership;
let productId: string;
let productHandle: string;

const connection = {
  provider: "openai",
  apiUrl: "https://ai.example/v1",
  apiKey: "sk-test",
  textModel: "text-model",
  textEuOnly: false,
  zeroDataRetention: false,
} as unknown as AiConnection;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`owner-ai-${run}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`owner-ai-${run}`}, 'Kaffe', null)`);
  const store = (await stores.getStore(`owner-ai-${run}`))!;
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`owner-ai-${run}@example.com`}`);
  member = { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, store, role: "owner" };
  const [product] = await db().execute<Row>(sql`
    select id, handle from commerce.products where store_id = ${store.id}::uuid and status = 'active' order by handle limit 1
  `);
  productId = String(product.id);
  productHandle = String(product.handle);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await closeDb();
});

/** A provider answering in the stream format: text in pieces, or tool calls whose arguments come in pieces. */
function sse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}
const says = (text: string) => sse(text.match(/[\s\S]{1,7}/g)!.map((piece) => ({ choices: [{ delta: { content: piece } }] })));
const calls = (...tools: { name: string; args: unknown }[]) =>
  sse(
    tools.flatMap((tool, index) => {
      const args = JSON.stringify(tool.args);
      return [
        { choices: [{ delta: { tool_calls: [{ index, id: `call-${index}`, function: { name: tool.name, arguments: "" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index, function: { arguments: args.slice(0, 5) } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index, function: { arguments: args.slice(5) } }] } }] },
      ];
    }),
  );

/** The model's answers in turn; what each request held is kept. */
function fakeModel(...answers: Response[]) {
  const requests: { messages: { role: string; content: string | null }[]; tools?: unknown[] }[] = [];
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
  await assistant.runTurn({ member, conversationId, message, emit: (e) => events.push(e), invalidate: () => {}, connection });
  return events;
}

describe("the owner assistant (D94)", () => {
  it("offers its tools as JSON Schema without refs", () => {
    for (const tool of OWNER_TOOLS) {
      const definition = toolDefinition(tool);
      expect(definition.parameters).toMatchObject({ type: "object" });
      expect(JSON.stringify(definition.parameters)).not.toContain("$ref");
    }
  });

  it("runs every tool that reads against the store's own data", async () => {
    // Every feature on (D178), so the tools behind one are offered; with the shop alone they are refused.
    const ctx = { account: member.account, store: { ...member.store, features: [...FEATURE_IDS] }, invalidate: () => {} };
    await expect(ownerTools.runOwnerTool({ ...ctx, store: { ...member.store, features: ["shop" as const] } }, "get_bonus_program", {})).rejects.toThrow(
      "Bonus program is switched off in this store.",
    );
    const args: Record<string, unknown> = {
      get_product: { product: productHandle },
      get_fields: { entity: "product", item: productHandle },
      get_order: { order: "1" },
      // A report (D346) names its figures; the rest of the spec has defaults.
      run_report: { metrics: ["net_sales"], dimensions: ["market"] },
      // An order's parcels and their carrier events (D238) are asked for by the order's number too.
      parcel_tracking: { order: "1" },
      // The history of one variant's stock (D172) is asked for by SKU, like a product's by its handle.
      stock_history: { sku: "DEMO-MUG-BLACK" },
      get_customer: { customer: "nobody@example.com" },
      explain_results: { experiment: "nobody" },
      explain_return: { return: "NOBODY-R1" },
      explain_privacy_request: { request: "00000000-0000-4000-8000-000000000000" },
      // A page (D308) is read by its address; a store has none by that name, which the tool says.
      get_page: { page: "nowhere" },
      // A domain (D315) is asked for by name; one the store doesn't have is said so.
      check_domain: { domain: "nowhere.example" },
      // Searching names it; listing DNS records names a domain whose DNS the store doesn't keep, which the tool says.
      search_domains: { query: "nordisk butikk" },
      list_dns_records: { domain: "nowhere.example" },
      plan_domain_move: { domain: "nowhere.example", goal: "leave" },
      start_dns_move_here: { domain: "nowhere.example" },
      // A support conversation (PSI AGT-01) is read by its id; one the store doesn't have is said so.
      get_support_conversation: { conversation: "00000000-0000-4000-8000-000000000000" },
      // An order change and an exchange (PSI AGT-01) name an order or a return; one the store doesn't have is said so.
      preview_order_change: { order: "1", change: [{ item: "x", quantity: 0 }], reason: "other" },
      preview_exchange: { return: "NOBODY-R1", replacements: [{ sku: "x", quantity: 1 }] },
      // Trying a theme (D308) names an install, and reading a look (D310) a look; one the store doesn't have is said so.
      try_theme: { install: "00000000-0000-4000-8000-000000000000" },
      get_page_look: { look: "00000000-0000-4000-8000-000000000000" },
      // A content type's entries (D326) are listed by its name, and an entry read by its id; ones the store doesn't have are said so.
      list_entries: { type: "nothing" },
      get_entry: { entry: "00000000-0000-4000-8000-000000000000" },
      // Customs and duties (D343) are read for one of the store's countries.
      customs_duties: { country: "NO" },
    };
    // A draft A/B test (D148) is a write that needs no yes: its own test makes one. So are tagging and archiving orders and writing a draft order (D173): they need arguments, and
    // `order-ops-tools.int.test.ts` runs each of them. Making a draft product and writing a draft's texts (D308) are too: `product-tools.int.test.ts` runs them. Building and changing a page's draft (D308) as well: `site-tools.int.test.ts` runs them.
    // Drafting a broadcast and tagging a customer (PSI AGT-01) too: `marketing-tools.int.test.ts` runs them; a support note and ending a conversation:
    // `support-manager-tools.int.test.ts`; logging time: `work-tools.int.test.ts` (Work's tools are refused here: the store has Work off).
    // Adding a theme to the library (D308): `design-tools.int.test.ts`; asking for a look at a page or the store (D310), which photographs it: `page-looks.int.test.ts`.
    // Searching the web and reading a page reach the network, and keeping a note or a comparison writes (D329): `research.int.test.ts`, with stand-ins.
    // Keeping the brand and designing a look write (D330): `brand.int.test.ts`. Writing an entry's draft (D326): `content-tools.int.test.ts`.
    // Saving a report (D346): `report-query.int.test.ts`.
    const WRITES_WITHOUT_A_YES = new Set(["save_report", "set_target", "set_brand", "design_look", "make_brand_marks", "search_web", "read_web_page", "save_research_note", "compare_options", "add_order_note", "draft_experiment", "tag_orders", "archive_orders", "create_draft_order", "create_product", "write_product_texts", "build_page", "edit_page", "draft_broadcast", "tag_customer", "add_support_note", "end_support_conversation", "log_time", "add_theme", "look_at_page", "look_at_store", "save_entry"]);
    for (const tool of OWNER_TOOLS.filter((t) => !("gate" in t) && !WRITES_WITHOUT_A_YES.has(t.name))) {
      const result = ownerTools.runOwnerTool(ctx, tool.name, args[tool.name] ?? {});
      if (tool.name === "get_order" || tool.name === "parcel_tracking") await expect(result).rejects.toThrow("No order 1 in this store.");
      else if (tool.name === "get_customer" || tool.name === "explain_results" || tool.name === "explain_return" || tool.name === "explain_privacy_request" || tool.name === "get_page" || tool.name === "check_domain" || tool.name === "list_dns_records" || tool.name === "plan_domain_move" || tool.name === "start_dns_move_here" || tool.name === "get_support_conversation" || tool.name === "preview_order_change" || tool.name === "preview_exchange" || tool.name === "try_theme" || tool.name === "get_page_look" || tool.name === "list_entries" || tool.name === "get_entry" || tool.name.startsWith("work_") || tool.name.startsWith("list_work_")) await expect(result).rejects.toThrow(ownerTools.OwnerToolError);
      else await expect(result, tool.name).resolves.toBeTruthy();
    }
    expect(await ownerTools.runOwnerTool(ctx, "get_product", { product: productHandle })).toMatchObject({
      handle: productHandle,
      variants: expect.arrayContaining([expect.objectContaining({ prices: expect.arrayContaining([expect.objectContaining({ country: "NO" })]) })]),
    });
    await expect(ownerTools.runOwnerTool(ctx, "list_orders", { limit: 500 })).rejects.toThrow("The arguments could not be read");
  });

  it("sets up, reads and switches off campaigns, kept for approval like the rest that goes public", async () => {
    const tags: string[] = [];
    const ctx = { account: member.account, store: member.store, invalidate: (tag: string) => void tags.push(tag) };
    expect(OWNER_TOOLS.find((t) => t.name === "create_campaign")).toMatchObject({ gate: "public" });
    expect(OWNER_TOOLS.find((t) => t.name === "set_campaign_active")).toMatchObject({ gate: "public" });
    expect(approvalSummary("create_campaign", { name: "Kaffe 3 for 2", kind: "multi_buy", buy_quantity: 3, pay_quantity: 2, categories: ["Hjem"], ends_on: "2026-11-30", usage_limit: 100 })).toBe(
      'Create the campaign "Kaffe 3 for 2": 3 for 2, categories Hjem, until 2026-11-30, at most 100 orders.',
    );

    // Named by what the owner says; the product, category and group are found by their names.
    const [category] = await db().execute<Row>(sql`select name from commerce.terms where store_id = ${member.store.id}::uuid and content_type = 'product' and kind = 'category' limit 1`);
    const made = await ownerTools.runOwnerTool(ctx, "create_campaign", { name: `Høstsalg ${run}`, kind: "percent", percent: 15, categories: [String(category.name)], products: [productHandle], ends_on: "2099-01-31", stacks: true });
    expect(made).toMatchObject({ done: expect.stringContaining("is set up and runs now") });
    expect(tags).toEqual([`campaigns:${member.store.id}`]);
    await expect(ownerTools.runOwnerTool(ctx, "create_campaign", { name: "x", kind: "percent", percent: 5, countries: ["Frankrike"] })).rejects.toThrow("does not sell to");
    const gift = await ownerTools.runOwnerTool(ctx, "create_campaign", { name: `Gratis ${run}`, kind: "gift", gift_sku: "DEMO-NOTEBOOK-LINED", amount: "500", starts_on: "2098-01-01" });
    expect(gift).toMatchObject({ done: expect.stringContaining("starts 2098-01-01") });

    const listed = (await ownerTools.runOwnerTool(ctx, "list_campaigns", {})) as { campaigns: Record<string, unknown>[] };
    const sale = listed.campaigns.find((c) => c.name === `Høstsalg ${run}`)!;
    expect(sale).toMatchObject({ status: "active", gives: "15 % off", adds_on_top_of_other_campaigns: true });
    expect(sale.applies_to).toEqual(expect.arrayContaining([String(category.name)]));
    expect(listed.campaigns.find((c) => c.name === `Gratis ${run}`)).toMatchObject({ status: "scheduled", gives: expect.stringContaining("Free product over"), free_product: expect.any(String) });

    expect(await ownerTools.runOwnerTool(ctx, "set_campaign_active", { campaign: `høstsalg ${run}`, active: false })).toMatchObject({ done: expect.stringContaining("is off") });
    const off = (await ownerTools.runOwnerTool(ctx, "list_campaigns", {})) as { campaigns: Record<string, unknown>[] };
    expect(off.campaigns.find((c) => c.name === `Høstsalg ${run}`)).toMatchObject({ status: "off" });

    // Said wrong, it says what is missing, and nothing is made.
    await expect(ownerTools.runOwnerTool(ctx, "create_campaign", { name: "x", kind: "percent" })).rejects.toThrow("how many percent");
    await expect(ownerTools.runOwnerTool(ctx, "create_campaign", { name: "x", kind: "multi_buy", buy_quantity: 3 })).rejects.toThrow("pay for");
    await expect(ownerTools.runOwnerTool(ctx, "create_campaign", { name: "x", kind: "gift", gift_sku: "NOPE", amount: "10" })).rejects.toThrow("No product with the SKU NOPE");
    await expect(ownerTools.runOwnerTool(ctx, "create_campaign", { name: "x", kind: "percent", percent: 5, categories: ["Finnes ikke"] })).rejects.toThrow("No product category");
    await expect(ownerTools.runOwnerTool(ctx, "create_campaign", { name: "x", kind: "percent", percent: 5, customer_groups: ["Ingen"] })).rejects.toThrow("No customer group");
    await expect(ownerTools.runOwnerTool(ctx, "set_campaign_active", { campaign: "Finnes ikke", active: true })).rejects.toThrow("No campaign");
  });

  it("manages the store's recommendations by chat: kept for approval, checked before they are kept, and read back worked out by the store (D140)", async () => {
    const tags: string[] = [];
    const ctx = { account: member.account, store: member.store, invalidate: (tag: string) => void tags.push(tag) };
    for (const name of ["set_recommendations", "add_recommendation_rule", "remove_recommendation_rule"]) expect(OWNER_TOOLS.find((t) => t.name === name)).toMatchObject({ gate: "public" });
    for (const name of ["get_recommendations", "check_recommendations"]) expect(OWNER_TOOLS.find((t) => t.name === name)?.gate).toBeUndefined();
    expect(approvalSummary("set_recommendations", { enabled: true, ai: false, upsell_ceiling_percent: 30, holdout_percent: 20, monthly_token_cap_thousands: null })).toBe(
      "Change the recommendations: switch the recommendations on; keep the AI out of them; an upsell costs at most 30 % more than its product; 20 % of visitors get the plain ranking; no monthly cap on the AI.",
    );
    expect(approvalSummary("add_recommendation_rule", { kind: "goes_with", product: "Lampe", other_product: "Pære", both: true })).toBe('Offer "Pære" with "Lampe" and the other way round.');
    expect(approvalSummary("add_recommendation_rule", { kind: "hide", product: "Lampe" })).toBe('Never recommend "Lampe".');
    expect(approvalSummary("remove_recommendation_rule", { kind: "never_with", product: "A", other_product: "B" })).toBe('Take away the rule that "A" is never shown with "B".');

    // Off until switched on; read back as the store sets it.
    const first = (await ownerTools.runOwnerTool(ctx, "get_recommendations", {})) as Record<string, unknown>;
    expect(first).toMatchObject({ on: false, ai_reranking: true, plain_ranking_share_percent: 10, upsell_ceiling_percent: 50, rules: [], period_days: 30 });
    expect(String(first.comparison)).toContain("Too few visitors");

    expect(await ownerTools.runOwnerTool(ctx, "set_recommendations", { enabled: true, upsell_ceiling_percent: 35, monthly_token_cap_thousands: 250 })).toMatchObject({
      done: "Recommendations are on with these settings.",
      upsell_ceiling_percent: 35,
      monthly_ai_cap: "250 thousand tokens",
    });
    expect(tags).toContain(`recommend:${member.store.id}`);
    const now = (await ownerTools.runOwnerTool(ctx, "get_recommendations", { days: "7" })) as Record<string, unknown>;
    expect(now).toMatchObject({ on: true, ai_reranking: true, upsell_ceiling_percent: 35, plain_ranking_share_percent: 10, period_days: 7 });
    // A change that cannot be made is refused before it is kept for a yes.
    await expect(ownerTools.preflightOwnerTool(ctx, "set_recommendations", { holdout_percent: 80 })).rejects.toThrow("The arguments could not be read");
    expect(await ownerTools.runOwnerTool(ctx, "set_recommendations", { monthly_token_cap_thousands: null })).toMatchObject({ monthly_ai_cap: "none" });

    // Rules by product names.
    const [other] = await db().execute<Row>(sql`select handle from commerce.products where store_id = ${member.store.id}::uuid and handle <> ${productHandle} order by handle limit 1`);
    const otherHandle = String(other.handle);
    expect(await ownerTools.runOwnerTool(ctx, "add_recommendation_rule", { kind: "goes_with", product: productHandle, other_product: otherHandle, both: true })).toMatchObject({ done: "The rule is added." });
    await ownerTools.runOwnerTool(ctx, "add_recommendation_rule", { kind: "hide", product: otherHandle });
    await expect(ownerTools.runOwnerTool(ctx, "add_recommendation_rule", { kind: "goes_with", product: productHandle })).rejects.toThrow("Name the other product");
    await expect(ownerTools.runOwnerTool(ctx, "add_recommendation_rule", { kind: "hide", product: "no-such-product" })).rejects.toThrow("No product");
    const listed = (await ownerTools.runOwnerTool(ctx, "get_recommendations", {})) as { rules: string[] };
    expect(listed.rules).toHaveLength(3);
    expect(listed.rules.some((r) => r.includes("goes with"))).toBe(true);
    expect(listed.rules.some((r) => r.includes("is never recommended"))).toBe(true);
    // Both ways go together; a rule that is not there is said so.
    expect(await ownerTools.runOwnerTool(ctx, "remove_recommendation_rule", { kind: "goes_with", product: productHandle, other_product: otherHandle })).toMatchObject({ done: "The rule is removed." });
    await ownerTools.runOwnerTool(ctx, "remove_recommendation_rule", { kind: "hide", product: otherHandle });
    expect(((await ownerTools.runOwnerTool(ctx, "get_recommendations", {})) as { rules: string[] }).rules).toEqual([]);
    await expect(ownerTools.runOwnerTool(ctx, "remove_recommendation_rule", { kind: "hide", product: otherHandle })).rejects.toThrow("There is no such rule");

    // The check against past orders is read-only and never asks a model; with no orders it says so.
    expect(await ownerTools.runOwnerTool(ctx, "check_recommendations", {})).toMatchObject({ checked: 0, note: expect.stringContaining("No order to check yet") });
  });

  let conversationId: string;

  it("answers from the store's own data, streaming, and keeps the conversation", async () => {
    const requests = fakeModel(
      calls({ name: "store_overview", args: {} }, { name: "sales_summary", args: { days: 7 } }),
      says("Kaffe er åpen og har ingen salg denne uken."),
    );
    const events = await turn("Hvordan går det med butikken?");
    const started = events.find((e) => e.type === "conversation");
    expect(started).toMatchObject({ title: "Hvordan går det med butikken?" });
    conversationId = (started as { id: string }).id;
    expect(events.filter((e) => e.type === "round")).toEqual([{ type: "round", tools: ["store_overview", "sales_summary"] }]);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      message: { role: "assistant", content: "Kaffe er åpen og har ingen salg denne uken.", tools: [{ name: "store_overview", ok: true }, { name: "sales_summary", ok: true }] },
    });
    // The tools answered from the store: its name, and no sales.
    const toolAnswers = requests[1].messages.filter((m) => m.role === "tool").map((m) => m.content ?? "");
    expect(toolAnswers[0]).toContain('"name":"Kaffe"');
    expect(toolAnswers[1]).toContain("No paid orders in this period.");
    expect(requests[0].messages[0].content).toContain("Never add up");
    const saved = (await assistant.getConversation(member, conversationId))!;
    expect(saved.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("answers a question about the figures from run_report, offers it as a report, and meters the answer as its own feature (D346)", async () => {
    const before = await db().execute<Row>(sql`select feature, count(*)::int as n from commerce.ai_usage where store_id = ${member.store.id}::uuid group by feature`);
    const count = (rows: Row[], feature: string) => Number(rows.find((r) => r.feature === feature)?.n ?? 0);
    fakeModel(calls({ name: "run_report", args: { metrics: ["net_sales", "orders"], dimensions: ["market"], period: { preset: "30d", compare: "none" } } }), says("Ingen salg siste 30 dager."));
    const events: AssistantEvent[] = [];
    const usage = { storeId: member.store.id, feature: "ai_manager" as const, accountId: member.account.id };
    await assistant.runTurn({ member, conversationId: null, message: "Salg per land?", emit: (e) => events.push(e), invalidate: () => {}, connection: { ...connection, source: "platform", usage } as AiConnection });
    const done = events.at(-1) as { type: "done"; message: { tools: { name: string; ok: boolean; report?: string }[] } };
    expect(done.message.tools).toEqual([{ name: "run_report", ok: true, report: expect.stringMatching(new RegExp(`^/admin/${member.store.slug}/analytics/reports/view\\?q=`)) }]);
    const after = await db().execute<Row>(sql`select feature, count(*)::int as n from commerce.ai_usage where store_id = ${member.store.id}::uuid group by feature`);
    // The round that chose the tool is the manager's; the round that answered from the report is the question's.
    expect(count(after, "ai_manager") - count(before, "ai_manager")).toBe(1);
    expect(count(after, "analytics_question") - count(before, "analytics_question")).toBe(1);
    const started = events.find((e) => e.type === "conversation") as { id: string };
    expect(await assistant.deleteConversation(member, started.id)).toBe(true);
  });

  it("gives the model a tool's refusal, and remembers the conversation", async () => {
    const requests = fakeModel(calls({ name: "get_order", args: { order: "99999" } }), says("Fant ingen ordre 99999."));
    await turn("Vis ordre 99999", conversationId);
    expect(requests[0].messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(requests[1].messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("No order 99999 in this store.") });
  });

  it("keeps a change for the owner's yes, and runs exactly that call once approved", async () => {
    fakeModel(calls({ name: "archive_product", args: { product: productHandle } }), says("Venter på at du godkjenner."));
    const events = await turn(`Ta ${productHandle} av nettsiden`, conversationId);
    const queued = events.find((e) => e.type === "approval") as { approval: Approval };
    expect(queued.approval).toMatchObject({ tool: "archive_product", category: "public", status: "pending", summary: `Take the product "${productHandle}" off the site.` });
    // Not done by the model alone.
    const [before] = await db().execute<Row>(sql`select status from commerce.products where id = ${productId}::uuid`);
    expect(before.status).toBe("active");

    const invalidated: string[] = [];
    const decided = await assistant.decideApproval(member, queued.approval.id, true, (tag) => invalidated.push(tag));
    expect(decided).toMatchObject({ status: "done", outcome: `${productHandle} is taken off the site.` });
    const [after] = await db().execute<Row>(sql`select status from commerce.products where id = ${productId}::uuid`);
    expect(after.status).toBe("archived");
    expect(invalidated).toEqual([`catalog:${member.store.id}`]);
    // Once.
    expect(await assistant.decideApproval(member, queued.approval.id, true, () => {})).toBeNull();
    const [logged] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.audit_log where store_id = ${member.store.id}::uuid and action = 'store.assistant.archive_product'
    `);
    expect(logged.n).toBe(1);
  });

  it("declines, and says so in the conversation", async () => {
    fakeModel(calls({ name: "archive_product", args: { product: productHandle, archived: false } }), says("Venter."));
    const events = await turn("Legg den tilbake", conversationId);
    const queued = events.find((e) => e.type === "approval") as { approval: Approval };
    expect(await assistant.decideApproval(member, queued.approval.id, false, () => {})).toMatchObject({ status: "declined" });
    const saved = (await assistant.getConversation(member, conversationId))!;
    expect(saved.messages.at(-1)).toMatchObject({ role: "assistant", content: expect.stringContaining("Declined:") });
    const [still] = await db().execute<Row>(sql`select status from commerce.products where id = ${productId}::uuid`);
    expect(still.status).toBe("archived");
  });

  it("is each owner's own, and says so when there is no text model", async () => {
    const other = { ...member, account: { ...member.account, id: "00000000-0000-4000-8000-000000000000" } };
    expect(await assistant.getConversation(other, conversationId)).toBeNull();
    expect(await assistant.decideApproval(other, conversationId, true, () => {})).toBeNull();
    const events: AssistantEvent[] = [];
    await assistant.runTurn({ member, conversationId: null, message: "Hei", emit: (e) => events.push(e), invalidate: () => {}, connection: null });
    expect(events).toEqual([{ type: "error", message: expect.stringContaining("Settings → AI") }]);
    expect(await assistant.deleteConversation(member, conversationId)).toBe(true);
    expect(await assistant.listConversations(member)).toEqual([]);
  });
});
