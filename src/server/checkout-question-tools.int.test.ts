import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { makeStore, ownerOf, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { preflightOwnerTool, runOwnerTool } = await import("./owner-tools");
const { checkoutQuestionApprovalWords } = await import("./checkout-question-tools");
const { checkoutQuestionsFor } = await import("./checkout-rules");

type Row = Record<string, unknown>;
type Question = { id: string; place: number; question: string; on: boolean; required: boolean; kind: string };

/**
 * The AI manager's questions at checkout (D357): read as the page lists them, refused before a yes when the page would refuse them, and added,
 * changed, switched and moved through the page's own writers, so the cart asks them as the owner approved; another store's question is never
 * reached, and every change is in the audit log in the owner's name.
 */

let fx: Fixture;
let other: Fixture;
beforeAll(async () => {
  fx = await makeStore("questions-ai");
  other = await makeStore("questions-other");
});
afterAll(async () => {
  await closeDb();
});

const ctxOf = async (f: Fixture) => ({ ...(await ownerOf(f)), holder: { role: "owner" as const }, invalidate: () => {} });

describe("the AI manager's checkout questions", () => {
  it("adds, changes, switches and moves a question through the page's writers, after refusing what the page refuses", async () => {
    const c = await ctxOf(fx);
    expect(((await runOwnerTool(c, "checkout_questions", {})) as { questions: unknown[] }).questions).toEqual([]);
    await expect(preflightOwnerTool(c, "save_checkout_question", { kind: "checkbox" })).rejects.toThrow(/main language/);
    await expect(preflightOwnerTool(c, "save_checkout_question", { id: "00000000-0000-4000-8000-000000000000", place: 1 })).rejects.toThrow(/not one of this store's/);
    await expect(preflightOwnerTool(c, "save_checkout_question", { question: "Gavehilsen" })).resolves.toBeUndefined();

    const first = (await runOwnerTool(c, "save_checkout_question", { question: "Portkode", required: true })) as { done: string; question: Question };
    expect(first.done).toBe("The question is added: shoppers are asked it at checkout.");
    expect(first.question).toMatchObject({ place: 1, question: "Portkode", kind: "text", required: true, on: true });
    const second = (await runOwnerTool(c, "save_checkout_question", { question: "Ikke ring på", kind: "checkbox", on: false })) as { done: string; question: Question };
    expect(second.done).toBe("The question is added, switched off.");

    // Moved first and switched on, without its words changing; then reworded alone.
    await runOwnerTool(c, "save_checkout_question", { id: second.question.id, place: 1, on: true });
    expect(await checkoutQuestionApprovalWords(c, { id: first.question.id, required: false })).toBe('Change the checkout question "Portkode": make it optional.');
    await runOwnerTool(c, "save_checkout_question", { id: first.question.id, required: false });
    const read = (await runOwnerTool(c, "checkout_questions", {})) as { questions: Question[] };
    expect(read.questions.map((q) => [q.place, q.question, q.kind, q.required, q.on])).toEqual([
      [1, "Ikke ring på", "checkbox", false, true],
      [2, "Portkode", "text", false, true],
    ]);
    // The cart asks them in that order.
    expect((await checkoutQuestionsFor(fx.storeId, "nb-NO", null)).fields.map((f) => f.label)).toEqual(["Ikke ring på", "Portkode"]);

    const audit = await db().execute<Row>(sql`
      select action, account_id from commerce.audit_log where store_id = ${fx.storeId}::uuid and action like 'shipping.checkout_field%' order by created_at
    `);
    expect(audit.map((a) => a.action)).toEqual([
      "shipping.checkout_field_made",
      "shipping.checkout_field_made",
      "shipping.checkout_field_off",
      "shipping.checkout_field_on",
      "shipping.checkout_field_moved",
      "shipping.checkout_field_changed",
    ]);
    expect(new Set(audit.map((a) => a.account_id))).toEqual(new Set([fx.ownerId]));
  });

  it("never reaches another store's question", async () => {
    const mine = await ctxOf(fx);
    const theirs = await ctxOf(other);
    const made = (await runOwnerTool(theirs, "save_checkout_question", { question: "Their question" })) as { question: Question };
    await expect(preflightOwnerTool(mine, "save_checkout_question", { id: made.question.id, on: false })).rejects.toThrow(/not one of this store's/);
    await expect(runOwnerTool(mine, "save_checkout_question", { id: made.question.id, on: false })).rejects.toThrow(/not one of this store's/);
    expect(((await runOwnerTool(theirs, "checkout_questions", {})) as { questions: Question[] }).questions).toEqual([expect.objectContaining({ question: "Their question", on: true })]);
  });
});
