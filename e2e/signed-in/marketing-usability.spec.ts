import { writeFileSync } from "node:fs";

import { expect, test, type Locator } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The usability test of email marketing (email plan M3.10, `docs/audits/email-marketing-usability-2026-11.md`): the five timed tasks of
 * the pass mark walked as the owner, each counting what Homer presses and types, from where he would start, against a limit. The
 * figures go to `test-results/marketing-usability.json` for the write-up; the limits only fall.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const STORE = "e2e-usability";
const RUN = Date.now().toString(36).toLowerCase();

type Task = { task: string; presses: number; typed: number; seconds: number };
const results: Task[] = [];

/** One task: what Homer pressed and typed, and how long it took (the machine's time, a floor for a person's). */
function measure(task: string) {
  const counted = { presses: 0, typed: 0 };
  const started = Date.now();
  return {
    press: async (target: Locator) => {
      counted.presses += 1;
      await target.click();
    },
    type: async (target: Locator, text: string) => {
      counted.typed += 1;
      await target.fill(text);
    },
    done: () => {
      const result = { task, ...counted, seconds: Math.round((Date.now() - started) / 100) / 10 };
      results.push(result);
      return result;
    },
  };
}

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Usability') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Usability', null)`;
    });
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()), status = 'active', locales = array['en-GB'] where slug = ${STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    await sql`
      insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
      values (${store.id}, ${`homer-${RUN}@example.com`}, 'en-GB', 'subscribed', 'form', 'Yes please', now(), ${(RUN + "u".repeat(43)).slice(0, 43)})`;
    await sql`insert into commerce.segments (store_id, title, rules) values (${store.id}, ${`Everyone ${RUN}`}, '{"match": "all", "conditions": []}')`;
  } finally {
    await sql.end();
  }
});

test.afterAll(() => {
  writeFileSync("test-results/marketing-usability.json", JSON.stringify(results, null, 2));
});

test("1. a first flow switched on from Marketing, without reading anything", async ({ page }) => {
  await page.goto(`/admin/${STORE}/marketing`);
  const t = measure("A first flow on");
  await t.press(page.getByRole("link", { name: "Flows", exact: true }).first());
  await t.press(page.getByRole("group", { name: "Welcome new subscribers" }).getByRole("button", { name: "Start" }));
  await t.press(page.getByRole("button", { name: "Test it" }));
  await t.press(page.getByRole("button", { name: "Switch on" }));
  await expect(page.getByText("On. New people go through it from now.")).toBeVisible();
  const r = t.done();
  expect(r.presses).toBeLessThanOrEqual(4);
  expect(r.typed).toBe(0);
  expect(r.seconds).toBeLessThan(180);
});

test("2. a broadcast to a segment, written and sent", async ({ page }) => {
  await page.goto(`/admin/${STORE}/marketing`);
  const t = measure("A broadcast to a segment");
  await t.press(page.getByRole("link", { name: "Broadcasts", exact: true }).first());
  await t.press(page.getByRole("link", { name: "Write your own" }));
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/broadcasts/new$`));
  await t.type(page.getByLabel("Name", { exact: true }), `Autumn ${RUN}`);
  await t.press(page.getByLabel("The people in a segment who want your emails"));
  await page.getByLabel("Segment", { exact: true }).selectOption({ label: `Everyone ${RUN}` });
  await t.type(page.getByLabel("Subject"), "Autumn news");
  await t.press(page.getByRole("button", { name: "Text", exact: true }));
  await t.type(page.getByRole("textbox", { name: "Text", exact: true }), "New things in the shop.");
  await t.press(page.getByRole("button", { name: "Save draft" }));
  await t.press(page.getByRole("button", { name: "Send now" }));
  await t.press(page.getByRole("button", { name: "Yes, send it" }));
  await expect(page.getByText("Went to", { exact: true })).toBeVisible();
  const r = t.done();
  expect(r.presses).toBeLessThanOrEqual(8);
  expect(r.typed).toBeLessThanOrEqual(3);
});

test("3. a word changed in step 2 of a flow", async ({ page }) => {
  await page.goto(`/admin/${STORE}/flows`);
  const t = measure("A word changed in step 2");
  await t.press(page.getByRole("list", { name: "Flows" }).getByRole("link", { name: "Welcome series" }).first());
  const second = page.locator("[data-flow-story] li").nth(1);
  await t.press(second.getByText("Change", { exact: true }));
  await t.type(second.getByLabel("Words").first(), "Thank you for your order, Homer.");
  await t.press(second.getByRole("button", { name: "Save" }).first());
  await expect(page.getByText("Saved. The flow is off until you test it again.")).toBeVisible();
  const r = t.done();
  expect(r.presses).toBeLessThanOrEqual(3);
});

test("4. what a flow brought, read on its page", async ({ page }) => {
  // Task 3 switched it off until tested again: test and switch it on, outside the count, as a running flow is what this asks about.
  await page.goto(`/admin/${STORE}/flows`);
  await page.getByRole("list", { name: "Flows" }).getByRole("link", { name: "Welcome series" }).first().click();
  await page.getByRole("button", { name: "Test it" }).click();
  await page.getByRole("button", { name: "Switch on" }).click();
  await expect(page.getByText("On. New people go through it from now.")).toBeVisible();
  await page.goto(`/admin/${STORE}/flows`);
  const t = measure("What a flow brought");
  await t.press(page.getByRole("list", { name: "Flows" }).getByRole("link", { name: "Welcome series" }).first());
  await expect(page.getByText("The last 30 days", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Nobody started it in the last 30 days|started it\. Its \d+ emails brought \d+ orders/)).toBeVisible();
  const r = t.done();
  expect(r.presses).toBeLessThanOrEqual(1);
});

test("5. a flow stopped", async ({ page }) => {
  await page.goto(`/admin/${STORE}/flows`);
  const t = measure("A flow stopped");
  await t.press(page.getByRole("list", { name: "Flows" }).getByRole("link", { name: "Welcome series" }).first());
  await t.press(page.getByRole("button", { name: "Switch off" }));
  await expect(page.getByRole("button", { name: "Switch on" })).toBeVisible();
  const r = t.done();
  // Lisa's depth from the same screen (pass mark 5): the contact policy is one press away.
  await expect(page.locator("[data-flow-contact-policy]")).toHaveAttribute("href", new RegExp(`/admin/${STORE}/marketing#contact-policy$`));
  expect(r.presses).toBeLessThanOrEqual(2);
});
