import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * Flows as the owner reads them (D767 slice 2, email plan M3.3): the welcome series started with one press, read as a story with its emails
 * drawn, tested on the newest subscriber, and switched on. What a flow sends and when is held by flows.int.test.ts.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const STORE = "e2e-flows";
const RUN = Date.now().toString(36);

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Flows') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Flows', null)`;
    });
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()), status = 'active', locales = array['en-GB'] where slug = ${STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    await sql`
      insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
      values (${store.id}, ${`ida-${RUN}@example.com`}, 'en-GB', 'subscribed', 'form', 'Yes please', now(), ${(RUN + "f".repeat(43)).slice(0, 43)})`;
  } finally {
    await sql.end();
  }
});

test("a welcome series is started with one press, read as a story, tested and switched on", async ({ page }) => {
  await page.goto(`/admin/${STORE}/flows`);
  // The page starts from a goal (slice 3): one Start per goal the store has no flow for yet.
  await expect(page.getByRole("group", { name: "Follow up after a purchase" })).toBeVisible();
  await page.screenshot({ path: "test-results/flow-goals.png", fullPage: true });
  await page.getByRole("group", { name: "Welcome new subscribers" }).getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/flows/[0-9a-f-]{36}$`));

  const story = page.locator("[data-flow-story]");
  await expect(story).toContainText("When someone joins your list:");
  await expect(story).toContainText("The same day:");
  await expect(story.getByLabel("Email: Welcome!")).toBeVisible();
  await expect(story).toContainText("3 days later, if they have ordered");
  await expect(story).toContainText("3 days later, if they have not ordered");
  await expect(page.getByText("Test it before switching it on.")).toBeVisible();
  // Each email's reach (M3.5): before the flow has a past, everyone who starts before a branch, at most that inside one.
  await expect(page.locator("[data-flow-story] [data-step-reach]").first()).toHaveText(/^About \d+ would get it in the next 30 days\.$/);
  await expect(page.locator("[data-flow-story] [data-step-reach]").last()).toHaveText(/^Up to \d+ would get it in the next 30 days, by which way they go\.$/);
  await page.screenshot({ path: "test-results/flow-story.png", fullPage: true });

  // The dry run (M3.5): each email drawn for the newest person, nothing sent.
  await page.getByRole("link", { name: "See the emails as the newest person on your list would get them" }).click();
  await expect(page.locator("[data-flow-drawn] iframe")).toHaveCount(2);
  await expect(page.locator("[data-flow-drawn]")).toContainText(`The emails as ida-${RUN}@example.com would get them`);
  // Seen at a phone's width (M3.4).
  await page.getByRole("navigation", { name: "Seen at" }).getByRole("link", { name: "Phone" }).click();
  await expect(page).toHaveURL(/width=phone/);
  expect((await page.locator("[data-flow-drawn] iframe").first().boundingBox())?.width ?? 0).toBeLessThanOrEqual(380);
  await page.screenshot({ path: "test-results/flow-phone.png", fullPage: true });
  // And as a mail app that turns it dark shows it (M3.4), still at a phone's width.
  await page.getByRole("navigation", { name: "Seen in" }).getByRole("link", { name: "Dark mode" }).click();
  await expect(page).toHaveURL(/width=phone&scheme=dark/);
  await expect(page.locator("[data-flow-drawn] iframe").first()).toHaveAttribute("srcdoc", /data-dark-preview/);
  await page.screenshot({ path: "test-results/flow-dark.png", fullPage: true });
  await page.getByRole("button", { name: "Test it" }).click();
  await expect(page.getByText(`Tested on ida-${RUN}@example.com: Welcome!, What others like best. Then it ends.`)).toBeVisible();
  await page.getByRole("button", { name: "Switch on" }).click();
  await expect(page.getByText("On. New people go through it from now.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch off" })).toBeVisible();

  await page.goto(`/admin/${STORE}/flows`);
  await expect(page.getByRole("list", { name: "Flows" })).toContainText("Welcome series");
  // Its goal is made, so only the other one is offered.
  await expect(page.getByRole("group", { name: "Welcome new subscribers" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Follow up after a purchase" })).toBeVisible();
  await page.screenshot({ path: "test-results/flow-list.png", fullPage: true });
});

test("an email's words and its wait are changed where they are, and the flow waits to be tested again", async ({ page }) => {
  await page.goto(`/admin/${STORE}/flows`);
  await page.getByRole("list", { name: "Flows" }).getByRole("link", { name: "Welcome series" }).first().click();
  const best = page.locator("[data-flow-story]").getByLabel("Email: What others like best");
  await best.getByText("Change", { exact: true }).click();
  // Its languages side by side (the store's own and its markets'); English is the store's first.
  const english = best.getByRole("group", { name: "English" });
  await english.getByLabel("Subject").fill("Our favourites");
  await english.getByLabel("Words").fill("See what others buy most.");
  await english.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. The flow is off until you test it again.")).toBeVisible();
  await page.reload();
  const changed = page.locator("[data-flow-story]").getByLabel("Email: Our favourites");
  await expect(changed).toContainText("See what others buy most.");
  await changed.getByText("Change", { exact: true }).click();
  await changed.getByLabel("Days later").fill("5");
  await changed.getByRole("button", { name: "Save" }).last().click();
  await expect(page.getByText("Saved. The flow is off until you test it again.")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-flow-story]")).toContainText("5 days later, if they have not ordered");
  await expect(page.getByText("Test it before switching it on.")).toBeVisible();
  await page.locator("[data-flow-story]").getByLabel("Email: Our favourites").getByText("Change", { exact: true }).click();
  await page.screenshot({ path: "test-results/flow-change.png", fullPage: true });
});

test("on the canvas, a step is added in a branch, dragged to a new place, changed and removed, and the story follows", async ({ page }) => {
  await page.goto(`/admin/${STORE}/flows`);
  await page.getByRole("list", { name: "Flows" }).getByRole("link", { name: "Welcome series" }).first().click();
  const canvas = page.locator("[data-flow-canvas]");
  await canvas.getByText("Customise", { exact: true }).click();
  const board = page.locator("[data-flow-board]");
  await expect(board.locator("[data-board-card=if]")).toHaveCount(1);
  const saved = board.getByRole("status");

  // Added by the keyboard path: the + first in the No branch, then Email.
  const no = board.locator("[data-board-branch=else]").first();
  await no.locator("[data-board-place]").first().getByRole("button", { name: "Add" }).click();
  await no.getByRole("group", { name: "Add" }).getByRole("button", { name: "Email" }).click();
  await expect(saved).toHaveText("Saved. The flow is off until you test it again.");
  await expect(page.locator("[data-flow-story]").getByLabel("Email: A new email")).toBeVisible();

  // Dragged: the new email onto the place first in the flow, above the welcome.
  const card = board.getByRole("button", { name: "Email: A new email" });
  const target = board.locator("[data-board-place]").first();
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("the canvas is not drawn");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator("[data-flow-story] li").first()).toContainText("A new email");

  // Changed in the panel: the if's condition.
  await board.locator("[data-board-card=if]").click();
  await page.getByRole("group", { name: "Change the condition to" }).getByRole("button", { name: "if they pressed a link" }).click();
  await expect(page.locator("[data-flow-story]")).toContainText("if they did not press a link");
  await page.screenshot({ path: "test-results/flow-canvas.png", fullPage: true });

  // Words changed where they are (M3.4): the new email's words, in the drawn email, saved on clicking away.
  await board.getByRole("button", { name: "Email: A new email" }).click();
  const words = page.locator("[data-email-in-place]").getByRole("textbox", { name: "Words" }).first();
  await words.fill("Written where it reads.");
  await words.press("Tab");
  await expect(page.locator("[data-email-in-place]").getByRole("status")).toHaveText("Saved. The flow is off until you test it again.");
  await expect(page.locator("[data-flow-story]").getByLabel("Email: A new email")).toContainText("Written where it reads.");
  // A block added between (M3.4): a button after the words, then removed again.
  const inPlace = page.locator("[data-email-in-place]");
  await inPlace.locator("[data-in-place-between]").last().getByRole("button", { name: "Add here" }).click();
  await inPlace.getByRole("group", { name: "Add here" }).getByRole("button", { name: "Button" }).click();
  await expect(inPlace.getByRole("textbox", { name: "Button words" })).toHaveText("See more");
  await page.screenshot({ path: "test-results/flow-in-place.png", fullPage: true });
  await inPlace.getByRole("textbox", { name: "Button words" }).hover();
  await inPlace.getByRole("button", { name: "Remove this" }).last().click();
  await expect(inPlace.getByRole("textbox", { name: "Button words" })).toHaveCount(0);
  // A product from the store (M3.4): found by the + between blocks, drawn by code when the email is made.
  await inPlace.locator("[data-in-place-between]").last().getByRole("button", { name: "Add here" }).click();
  await inPlace.getByRole("button", { name: "Product or offer" }).click();
  await inPlace.getByRole("list", { name: "Products" }).getByRole("button", { name: "Add" }).first().click();
  await expect(inPlace.locator("[data-in-place-fact=product]")).toHaveCount(1);
  await page.screenshot({ path: "test-results/flow-in-place-product.png", fullPage: true });
  await inPlace.locator("[data-in-place-fact=product]").hover();
  await inPlace.getByRole("button", { name: "Remove this" }).last().click();
  await expect(inPlace.locator("[data-in-place-fact=product]")).toHaveCount(0);
  // Written with AI (M3.7): without an AI set up for the store, nothing changes and the owner is told why.
  await inPlace.locator("[data-write-with-ai] summary").click();
  await inPlace.getByLabel("What is this email about?").fill("Thank them, and show our favourites");
  await inPlace.getByRole("button", { name: "Write", exact: true }).click();
  await expect(inPlace.getByRole("status")).toHaveText("No AI with a text model is set up for this store.");
  await expect(inPlace.getByRole("textbox", { name: "Words" }).first()).toHaveText("Written where it reads.");
  await page.screenshot({ path: "test-results/flow-write-ai.png", fullPage: true });
  await inPlace.getByRole("button", { name: "Suggest three subject lines" }).click();
  await expect(inPlace.locator("[data-subject-choices]").getByRole("alert")).toHaveText("No AI with a text model is set up for this store.");
  await inPlace.locator("[data-rewrite]").getByRole("button", { name: "Shorter" }).click();
  await expect(inPlace.getByRole("status")).toHaveText("No AI with a text model is set up for this store.");
  await expect(inPlace.getByRole("textbox", { name: "Words" }).first()).toHaveText("Written where it reads.");
  // Languages side by side (M3.4): Norwegian is not written yet, started from the English words to translate in place.
  await inPlace.getByRole("group", { name: "Languages" }).getByRole("button", { name: /Norsk bokmål/ }).click();
  await inPlace.getByRole("button", { name: "Translate from English with AI" }).click();
  await expect(inPlace.getByRole("status")).toHaveText("No AI with a text model is set up for this store.");
  await inPlace.getByRole("button", { name: "Start from the English words" }).click();
  await expect(inPlace.getByRole("textbox", { name: "Words" }).first()).toHaveText("Written where it reads.");
  await page.screenshot({ path: "test-results/flow-in-place-languages.png", fullPage: true });

  // Removed in the panel: gone from the story.
  await board.getByRole("button", { name: "Email: A new email" }).click();
  await page.locator("[data-board-panel]").getByRole("button", { name: "Remove" }).click();
  await expect(page.locator("[data-flow-story]").getByLabel("Email: A new email")).toHaveCount(0);
  await expect(board.locator("[data-board-card=if]")).toHaveCount(1);
});

test("an email's words are written in each of the store's languages side by side, and the missing one is named", async ({ page }) => {
  // The store writes English; its Norwegian market brings Norwegian (localization's locales).
  await page.goto(`/admin/${STORE}/flows`);
  await page.getByRole("list", { name: "Flows" }).getByRole("link", { name: "Welcome series" }).first().click();
  const welcome = page.locator("[data-flow-story]").getByLabel("Email: Welcome!");
  await expect(welcome).toContainText("Not written in Norsk bokmål yet; those readers get it in English.");
  await welcome.getByText("Change", { exact: true }).click();
  const norsk = welcome.getByRole("group", { name: "Norsk bokmål" });
  await norsk.getByLabel("Subject").fill("Velkommen!");
  await norsk.getByLabel("Words").fill("Takk for at du vil høre fra oss.");
  await page.screenshot({ path: "test-results/flow-languages.png", fullPage: true });
  await norsk.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. The flow is off until you test it again.")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-flow-story]").getByLabel("Email: Welcome!")).not.toContainText("Not written in");
});

test("a goal whose automation the owner already wrote starts from their words, days and follow-ups", async ({ page }) => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    const words = (subject: string, text: string) => ({ "en-GB": { subject, preview: "", blocks: [{ type: "paragraph", text }] } });
    await sql`
      insert into commerce.automations (store_id, kind, enabled, delay_days, content)
      values (${store.id}, 'after_purchase', false, 5, ${sql.json(words("How was it?", "Tell us how your order went."))})
      on conflict (store_id, kind) do update set delay_days = 5, content = excluded.content`;
  } finally {
    await sql.end();
  }
  await page.goto(`/admin/${STORE}/flows`);
  const goal = page.getByRole("group", { name: "Follow up after a purchase" });
  await expect(goal).toContainText("Starts from the email you already send for this, with its days and follow-ups.");
  await goal.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/flows/[0-9a-f-]{36}$`));
  const story = page.locator("[data-flow-story]");
  await expect(story).toContainText("When someone pays for an order:");
  await expect(story).toContainText("5 days later:");
  await expect(story.getByLabel("Email: How was it?")).toContainText("Tell us how your order went.");
});

test("bring back customers starts from 90 days without an order, and its days are changed where they are said (slice 4)", async ({ page }) => {
  await page.goto(`/admin/${STORE}/flows`);
  await page.getByRole("group", { name: "Bring back customers" }).getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/flows/[0-9a-f-]{36}$`));
  const story = page.locator("[data-flow-story]");
  await expect(story).toContainText("When someone has not ordered for 90 days: It stops when they order.");
  await expect(story.getByLabel("Email: We miss you")).toBeVisible();
  await story.getByText("Change", { exact: true }).first().click();
  await page.getByLabel("Days without an order").fill("120");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Saved. The flow is off until you test it again.")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-flow-story]")).toContainText("When someone has not ordered for 120 days:");
  await page.screenshot({ path: "test-results/flow-win-back.png", fullPage: true });
});

test("your own flow starts from one email, and what starts it is chosen under Customise (slice 4)", async ({ page }) => {
  await page.goto(`/admin/${STORE}/flows`);
  await page.getByRole("group", { name: "Your own flow" }).getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/flows/[0-9a-f-]{36}$`));
  await expect(page.locator("[data-flow-story]")).toContainText("When an order is sent:");
  const canvas = page.locator("[data-flow-canvas]");
  await canvas.getByText("Customise", { exact: true }).click();
  await canvas.locator("[data-board-trigger]").click();
  await expect(canvas.getByRole("group", { name: "What starts it" }).getByRole("button", { name: "When an order is refunded" })).toBeVisible();
  await page.screenshot({ path: "test-results/flow-trigger-choices.png", fullPage: true });
  await canvas.getByRole("group", { name: "What starts it" }).getByRole("button", { name: "When someone sends a form" }).click();
  await expect(page.getByText("Saved. The flow is off until you test it again.")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-flow-story]")).toContainText("When someone sends a form:");
  await page.locator("[data-flow-canvas]").getByText("Customise", { exact: true }).click();
  await page.screenshot({ path: "test-results/flow-starts-when.png", fullPage: true });
});

test("sell more to buyers shows products picked for each reader, chosen per email under Customise (slice 4)", async ({ page }) => {
  await page.goto(`/admin/${STORE}/flows`);
  await page.getByRole("group", { name: "Sell more to buyers" }).getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/flows/[0-9a-f-]{36}$`));
  const story = page.locator("[data-flow-story]");
  await expect(story).toContainText("When an order is sent:");
  await expect(story.getByLabel("Email: Goes well together")).toContainText("With what others bought with their order.");
  const canvas = page.locator("[data-flow-canvas]");
  await canvas.getByText("Customise", { exact: true }).click();
  await canvas.getByRole("button", { name: "Email: Goes well together" }).click();
  await canvas.getByRole("group", { name: "Products for each reader" }).getByRole("button", { name: "Buy again" }).click();
  await expect(page.getByText("Saved. The flow is off until you test it again.")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-flow-story]").getByLabel("Email: Goes well together")).toContainText("With their order's products that customers buy again.");
  await page.locator("[data-flow-canvas]").getByText("Customise", { exact: true }).click();
  await page.screenshot({ path: "test-results/flow-picks.png", fullPage: true });
});

test("on the canvas, a wait-until and a tag are added, and the story says the wait (M2.1)", async ({ page }) => {
  await page.goto(`/admin/${STORE}/flows`);
  await page.getByRole("list", { name: "Flows" }).getByRole("link", { name: "Welcome series" }).first().click();
  await page.locator("[data-flow-canvas]").getByText("Customise", { exact: true }).click();
  const board = page.locator("[data-flow-board]");
  const saved = board.getByRole("status");
  const no = board.locator("[data-board-branch=else]").first();
  await no.locator("[data-board-place]").first().getByRole("button", { name: "Add" }).click();
  await no.getByRole("group", { name: "Add" }).getByRole("button", { name: "Tag them" }).click();
  await expect(saved).toHaveText("Saved. The flow is off until you test it again.");
  await expect(board.locator("[data-board-card=tag]")).toHaveCount(1);
  await no.locator("[data-board-place]").first().getByRole("button", { name: "Add" }).click();
  await no.getByRole("group", { name: "Add" }).getByRole("button", { name: "Wait until" }).click();
  await expect(board.locator("[data-board-card=until]")).toHaveCount(1);
  await board.locator("[data-board-card=until]").click();
  await page.locator("[data-board-panel]").getByRole("button", { name: /once they press a link/ }).click();
  await expect(page.locator("[data-flow-story]")).toContainText("once they press a link, or 3 days later");
  if (process.env.E2E_SHOT) await page.screenshot({ path: process.env.E2E_SHOT, fullPage: true });
});
