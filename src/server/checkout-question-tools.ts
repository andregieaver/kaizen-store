import "server-only";

import { checkoutQuestionSummary, questionChange, type SaveCheckoutQuestionInput } from "@/lib/checkout-question-tools";
import { FIELDS_MAX } from "@/lib/checkout-rules";

import { db } from "@/db/client";

import { passMembership, type Account, type Membership } from "./auth";
import { listCheckoutFields, moveCheckoutField, saveCheckoutField, switchCheckoutField, type FieldRow } from "./checkout-rules";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";

/**
 * The AI manager's questions at checkout (D357, task 1 of `docs/checkout-fields-tasks.md`): `checkout_questions` reads what Settings, Checkout
 * rules lists under *Questions at checkout*; `save_checkout_question` adds one, changes its words, kind or required, switches it or moves it,
 * through that page's own writers (`saveCheckoutField()`, `switchCheckoutField()`, `moveCheckoutField()`), after the owner's yes (gate `public`:
 * shoppers are asked it). It is checked first (`preflightCheckoutQuestion()`), so a question the page would refuse is never kept for a yes.
 * Shoppers' answers are never read here: they are personal data, on the order's page.
 */

type Ctx = { account: Account; store: Store };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const adminLink = (store: Store) => `/admin/${store.slug}/settings/checkout`;

async function member(ctx: Ctx): Promise<Membership> {
  return (await passMembership(ctx.store.slug, ctx.account.id)) ?? fail("You are not a member of this store any more.");
}

const asked = (fields: FieldRow[]) =>
  fields.map((f, i) => ({
    id: f.id,
    place: i + 1,
    question: f.label.text,
    question_in: f.label.byLocale,
    kind: f.kind,
    required: f.required,
    help: f.help?.text ?? null,
    help_in: f.help?.byLocale ?? {},
    on: f.enabled,
  }));

export async function checkoutQuestionsTool({ store }: Ctx) {
  const fields = await listCheckoutFields(db(), store.id);
  return {
    questions: asked(fields),
    limit: FIELDS_MAX,
    main_language: store.localization.locales[0] ?? "en",
    note:
      "Asked above the cart's checkout button in this order, those on only; the answers are kept on the order and in its export. A store with any question on has no express checkout (Apple Pay, Google Pay), as a wallet's sheet cannot ask it. " +
      "Ask only what the order needs, and nothing about health, beliefs or other sensitive matters unless the owner says the sale cannot be made without it (GDPR article 9). Deleting is done on the page.",
    admin: adminLink(store),
  };
}

/** The question a call names and the change laid over it, or the refusal in the page's words. */
async function changeOf({ store }: Ctx, input: SaveCheckoutQuestionInput) {
  const fields = await listCheckoutFields(db(), store.id);
  const had = input.id ? (fields.find((f) => f.id === input.id) ?? null) : null;
  const checked = questionChange(input, had, store.localization.locales, fields.length);
  if (!checked.ok) return fail(checked.problems.join(" "));
  return { had, change: checked.change };
}

/** Refuses now what the page would refuse, so nothing is kept for a yes that could not be done. */
export async function preflightCheckoutQuestion(ctx: Ctx, raw: Record<string, unknown>): Promise<void> {
  await changeOf(ctx, raw as SaveCheckoutQuestionInput);
}

/** The approval's words, with the question's own words for a change. */
export async function checkoutQuestionApprovalWords({ store }: Ctx, args: Record<string, unknown>): Promise<string> {
  const name = typeof args.id === "string" ? (await listCheckoutFields(db(), store.id)).find((f) => f.id === args.id)?.label.text : undefined;
  return checkoutQuestionSummary(args, name);
}

export async function saveCheckoutQuestionTool(ctx: Ctx, input: SaveCheckoutQuestionInput) {
  const { had, change } = await changeOf(ctx, input);
  const who = await member(ctx);
  let id = had?.id ?? null;
  if (change.field) {
    const saved = await saveCheckoutField(who, id, change.field);
    if (!saved.ok) return fail(saved.problems.join(" "));
    id = saved.id;
  }
  if (!id) return fail("The question could not be saved.");
  if (change.on !== undefined && change.on !== (had?.enabled ?? true)) await switchCheckoutField(who, id, change.on);
  if (change.to !== undefined) await moveCheckoutField(who, id, change.to);
  const fields = await listCheckoutFields(db(), ctx.store.id);
  const now = asked(fields).find((q) => q.id === id);
  return {
    done: had ? "The question is changed." : now?.on ? "The question is added: shoppers are asked it at checkout." : "The question is added, switched off.",
    question: now,
    questions: asked(fields).map((q) => ({ id: q.id, place: q.place, question: q.question, on: q.on })),
    admin: adminLink(ctx.store),
  };
}
