import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  answersByField,
  applyCheckoutRules,
  FIELDS_MAX,
  NO_RULES,
  RULES_MAX,
  type CheckoutFacts,
  type CheckoutField,
  type CheckoutRule,
  type KnownIds,
  type RuleOutcome,
  type ShownField,
  type Words,
  shownField,
} from "@/lib/checkout-rules";
import { fieldInputSchema, ruleInputSchema } from "@/lib/checkout-rules-schema";
import { shown, type Market } from "@/lib/markets";
import { SWITCHABLE_METHODS } from "@/lib/payment-methods";
import { DEFAULT_WEIGHT_GRAMS } from "@/lib/shipping-limits";

import { audit, type Membership } from "./auth";
import { termsOfProducts } from "./campaigns";
import { customerTierIds } from "./customer-tiers";
import { log } from "./log";
import { col, typedRows } from "./typed-rows";

type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * Checkout rules and fields (wave 9 unit D, D357, `docs/wave-9-platform.md` section 3, D): the only writer of `commerce.checkout_rules`,
 * `checkout_rule_skips` and `checkout_fields`, and the one place a basket's facts are read for the rules (`checkoutRuleOutcome()`), so the cart
 * (`cartSummary()`), the delivery reader (`resolveDelivery()`) and checkout (`placeOrder()`) evaluate the same rules on the same facts.
 */

const ruleRow = z.object({ id: col.uuid, name: col.text, position: col.int, conditions: z.unknown(), effect: z.unknown(), enabled: col.bool });

export type RuleRow = CheckoutRule & { position: number; enabled: boolean; skips: { reason: string; count: number; lastAt: string }[] };

/** The store's rules in order, with the skips each has gathered. */
export async function listCheckoutRules(storeId: string): Promise<RuleRow[]> {
  const rows = await typedRows(
    ruleRow,
    sql`select id, name, position, conditions, effect, enabled from commerce.checkout_rules where store_id = ${storeId}::uuid order by position, created_at`,
  );
  const skips = await db().execute(sql`
    select rule_id, reason, count, last_at from commerce.checkout_rule_skips where store_id = ${storeId}::uuid
  `);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    enabled: r.enabled,
    conditions: r.conditions as CheckoutRule["conditions"],
    effect: r.effect as CheckoutRule["effect"],
    skips: skips
      .filter((s) => String(s.rule_id) === r.id)
      .map((s) => ({ reason: String(s.reason), count: Number(s.count), lastAt: new Date(String(s.last_at)).toISOString() })),
  }));
}

export type SaveRuleOutcome = { ok: true; id: string } | { ok: false; problems: string[] };

/** What the store's own ids say of a rule: a product, category, tag, group, delivery option or payment method not the store's is refused. */
async function ruleProblems(storeId: string, rule: Omit<CheckoutRule, "id">): Promise<string[]> {
  const known = await knownIds(db(), storeId);
  const problems: string[] = [];
  for (const c of rule.conditions) {
    if (c.kind === "product" && c.ids.some((id) => !known.products.has(id))) problems.push("Choose products of this store.");
    if ((c.kind === "category" || c.kind === "tag") && c.ids.some((id) => !known.terms.has(id))) problems.push("Choose categories and tags of this store.");
    if (c.kind === "group" && c.ids.some((id) => !known.tiers.has(id))) problems.push("Choose customer groups of this store.");
  }
  const e = rule.effect;
  if ((e.kind === "hide_shipping" || e.kind === "order_delivery") && e.options.some((o) => !known.options.has(o))) problems.push("Choose delivery options of this store.");
  if (e.kind === "rename_shipping" && !known.options.has(e.option)) problems.push("Choose a delivery option of this store.");
  if (e.kind === "hide_payment_method" && e.methods.some((m) => !known.methods.has(m))) problems.push("Cards are always offered; choose other methods.");
  return [...new Set(problems)];
}

/** Makes or changes a rule. A new rule is saved off and goes last; a change keeps whether it is on. */
export async function saveCheckoutRule(member: Membership, id: string | null, raw: unknown): Promise<SaveRuleOutcome> {
  const parsed = ruleInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const input = parsed.data;
  const problems = await ruleProblems(member.store.id, input);
  if (problems.length > 0) return { ok: false, problems };
  const storeId = member.store.id;
  if (id) {
    const done = await db().execute(sql`
      update commerce.checkout_rules set name = ${input.name}, conditions = ${JSON.stringify(input.conditions)}::jsonb, effect = ${JSON.stringify(input.effect)}::jsonb,
        updated_by = ${member.account.id}::uuid, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${id}::uuid returning id
    `);
    if (done.length === 0) return { ok: false, problems: ["This rule is gone."] };
    // A rule put right starts again without its skips.
    await db().execute(sql`delete from commerce.checkout_rule_skips where store_id = ${storeId}::uuid and rule_id = ${id}::uuid`);
    await audit(member.account.id, storeId, "shipping.checkout_rule_changed", { effect: input.effect.kind, conditions: input.conditions.length }, { target: { type: "checkout_rule", id } });
    return { ok: true, id };
  }
  const [count] = await db().execute(sql`select count(*)::int as n from commerce.checkout_rules where store_id = ${storeId}::uuid`);
  if (Number(count?.n ?? 0) >= RULES_MAX) return { ok: false, problems: [`A store has at most ${RULES_MAX} checkout rules.`] };
  const [row] = await db().execute(sql`
    insert into commerce.checkout_rules (store_id, name, position, conditions, effect, created_by, updated_by)
    values (${storeId}::uuid, ${input.name},
      (select coalesce(max(position), -1) + 1 from commerce.checkout_rules where store_id = ${storeId}::uuid),
      ${JSON.stringify(input.conditions)}::jsonb, ${JSON.stringify(input.effect)}::jsonb, ${member.account.id}::uuid, ${member.account.id}::uuid)
    returning id
  `);
  const made = String(row.id);
  await audit(member.account.id, storeId, "shipping.checkout_rule_made", { effect: input.effect.kind, conditions: input.conditions.length }, { target: { type: "checkout_rule", id: made } });
  return { ok: true, id: made };
}

/** Switches a rule on or off. */
export async function switchCheckoutRule(member: Membership, id: string, on: boolean): Promise<boolean> {
  const done = await db().execute(sql`
    update commerce.checkout_rules set enabled = ${on}, updated_by = ${member.account.id}::uuid, updated_at = now()
    where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id
  `);
  if (done.length === 0) return false;
  await audit(member.account.id, member.store.id, on ? "shipping.checkout_rule_on" : "shipping.checkout_rule_off", {}, { target: { type: "checkout_rule", id } });
  return true;
}

/** Moves a rule one place up or down: the order rules are read in, which decides the first rename and the first refusal. */
export async function moveCheckoutRule(member: Membership, id: string, by: -1 | 1): Promise<void> {
  const rules = await listCheckoutRules(member.store.id);
  const at = rules.findIndex((r) => r.id === id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= rules.length) return;
  const order = rules.map((r) => r.id);
  [order[at], order[to]] = [order[to], order[at]];
  await db().transaction(async (tx) => {
    for (const [i, ruleId] of order.entries()) {
      await tx.execute(sql`update commerce.checkout_rules set position = ${i} where store_id = ${member.store.id}::uuid and id = ${ruleId}::uuid`);
    }
  });
}

export async function deleteCheckoutRule(member: Membership, id: string): Promise<void> {
  const done = await db().execute(sql`delete from commerce.checkout_rules where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id`);
  if (done.length > 0) await audit(member.account.id, member.store.id, "shipping.checkout_rule_deleted", {}, { target: { type: "checkout_rule", id } });
}

/** Everything a rule may name that the store has: its delivery options in every country, products, categories and tags, groups, payment methods. */
export async function knownIds(runner: Runner, storeId: string): Promise<KnownIds> {
  const [row] = await runner.execute(sql`
    select
      (select coalesce(array_agg('method:' || id::text), '{}') from commerce.shipping_methods where store_id = ${storeId}::uuid) as methods,
      (select coalesce(array_agg('pickup:' || id::text), '{}') from commerce.pickup_options where store_id = ${storeId}::uuid) as pickups,
      (select coalesce(array_agg('local:' || id::text), '{}') from commerce.local_delivery_areas where store_id = ${storeId}::uuid) as areas,
      (select coalesce(array_agg(id::text), '{}') from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product') as terms,
      (select coalesce(array_agg(id::text), '{}') from commerce.customer_tiers where store_id = ${storeId}::uuid) as tiers
  `);
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return {
    options: new Set(["flat", ...list(row?.methods), ...list(row?.pickups), ...list(row?.areas)]),
    // Products are checked one rule at a time against the basket's (`productsKnown()`): a store may have many.
    products: new Set(),
    terms: new Set(list(row?.terms)),
    tiers: new Set(list(row?.tiers)),
    methods: new Set(SWITCHABLE_METHODS.map((m) => m.type)),
  };
}

/** Which of the products the rules name still exist in the store. */
async function productsKnown(runner: Runner, storeId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await runner.execute(sql`
    select id from commerce.products where store_id = ${storeId}::uuid and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
  return new Set(rows.map((r) => String(r.id)));
}

/** The store's rules that are on, in order. */
async function activeRules(runner: Runner, storeId: string): Promise<CheckoutRule[]> {
  const rows = await runner.execute(sql`
    select id, name, conditions, effect from commerce.checkout_rules where store_id = ${storeId}::uuid and enabled order by position, created_at
  `);
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), conditions: r.conditions as CheckoutRule["conditions"], effect: r.effect as CheckoutRule["effect"] }));
}

/**
 * The rules' outcome for a cart (D357): the basket's facts read from the cart's lines (products, their categories and tags, the weight of what is
 * shipped, the value shown) and the buyer's groups, evaluated by `applyCheckoutRules()`. `basketValueMinor` is the value the caller judges free
 * shipping on (as `resolveDelivery()` takes it); left out, the lines at their current prices. Skips are recorded, never thrown; a store with no
 * rule on reads nothing more.
 */
export async function checkoutRuleOutcome(
  runner: Runner,
  storeId: string,
  cartId: string,
  market: Pick<Market, "code" | "conversion">,
  { customerId = null, basketValueMinor }: { customerId?: string | null; basketValueMinor?: number } = {},
): Promise<RuleOutcome> {
  const rules = await activeRules(runner, storeId);
  if (rules.length === 0) return NO_RULES;
  // The currency and language the cart is shown in (a market's view, D109): what an amount is compared in and the words chosen.
  const [cart] = await runner.execute(sql`select currency, locale from commerce.carts where store_id = ${storeId}::uuid and id = ${cartId}::uuid`);
  if (!cart) return NO_RULES;
  const lines = await runner.execute(sql`
    select p.id as product_id, cl.quantity, cl.starts_at, v.delivery, v.weight_grams, cp.amount_minor, p.kind
    from commerce.cart_lines cl
    join commerce.product_variants v on v.store_id = cl.store_id and v.id = cl.variant_id
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${market.code}
    where cl.store_id = ${storeId}::uuid and cl.cart_id = ${cartId}::uuid
  `);
  const [settings] = await runner.execute(sql`select default_weight_grams from commerce.shipping_settings where store_id = ${storeId}::uuid`);
  const defaultWeight = Number(settings?.default_weight_grams ?? DEFAULT_WEIGHT_GRAMS);
  const productIds = [...new Set(lines.map((l) => String(l.product_id)))];
  const terms = await termsOfProducts(runner, storeId, productIds);
  const weight = lines
    .filter((l) => l.delivery === "physical" && !l.starts_at)
    .reduce((sum, l) => sum + (l.weight_grams === null || l.weight_grams === undefined ? defaultWeight : Number(l.weight_grams)) * Number(l.quantity), 0);
  const value =
    basketValueMinor ??
    lines.reduce((sum, l) => {
      if (l.amount_minor === null || l.amount_minor === undefined || l.kind === "gift_card") return sum;
      const unit = shown(market, Number(l.amount_minor));
      return sum + (l.starts_at && (l.kind === "stay" || l.kind === "rental") ? unit : unit * Number(l.quantity));
    }, 0);
  const facts: CheckoutFacts = {
    country: market.code,
    currency: String(cart.currency).trim(),
    totalMinor: value,
    weightGrams: weight,
    productIds,
    termIds: [...new Set([...terms.values()].flat())],
    tierIds: await customerTierIds(runner, storeId, customerId),
  };
  const known = await knownIds(runner, storeId);
  const named = [...new Set(rules.flatMap((r) => (Array.isArray(r.conditions) ? r.conditions : []).flatMap((c) => (c?.kind === "product" && Array.isArray(c.ids) ? c.ids : []))))];
  const outcome = applyCheckoutRules(rules, facts, { ...known, products: await productsKnown(runner, storeId, named) }, String(cart.locale));
  if (outcome.skipped.length > 0) await recordSkips(storeId, outcome.skipped);
  return outcome;
}

/** Counts each skipped rule once per call, on its own connection so a refused order's rollback keeps it; never throws. */
async function recordSkips(storeId: string, skipped: RuleOutcome["skipped"]): Promise<void> {
  for (const s of skipped) {
    if (!/^[0-9a-f-]{36}$/i.test(s.ruleId)) continue;
    try {
      await db().execute(sql`
        insert into commerce.checkout_rule_skips (store_id, rule_id, reason) values (${storeId}::uuid, ${s.ruleId}::uuid, ${s.reason})
        on conflict (rule_id, reason) do update set count = commerce.checkout_rule_skips.count + 1, last_at = now()
      `);
    } catch (error) {
      log("warn", "checkout_rule.skip_not_recorded", { storeId, ruleId: s.ruleId }, error);
    }
  }
}

// Checkout fields

const fieldRow = z.object({ id: col.uuid, kind: col.text, required: col.bool, label: z.unknown(), help: z.unknown(), position: col.int, enabled: col.bool });

export type FieldRow = CheckoutField & { position: number; enabled: boolean };

const asWords = (v: unknown): Words => {
  const w = (v ?? {}) as Partial<Words>;
  return { text: typeof w.text === "string" ? w.text : "", byLocale: w.byLocale && typeof w.byLocale === "object" ? w.byLocale : {} };
};

/** The store's checkout fields in order; `onlyOn` leaves out those switched off (what the shopper sees). */
export async function listCheckoutFields(runner: Runner, storeId: string, { onlyOn = false }: { onlyOn?: boolean } = {}): Promise<FieldRow[]> {
  const rows = await typedRows(
    fieldRow,
    sql`
      select id, kind, required, label, help, position, enabled from commerce.checkout_fields
      where store_id = ${storeId}::uuid and (${!onlyOn} or enabled) order by position, created_at
    `,
    runner,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind === "checkbox" ? "checkbox" : "text",
    required: r.required,
    label: asWords(r.label),
    help: r.help ? asWords(r.help) : null,
    position: r.position,
    enabled: r.enabled,
  }));
}

export async function saveCheckoutField(member: Membership, id: string | null, raw: unknown): Promise<SaveRuleOutcome> {
  const parsed = fieldInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const f = parsed.data;
  const storeId = member.store.id;
  if (id) {
    const done = await db().execute(sql`
      update commerce.checkout_fields set kind = ${f.kind}, required = ${f.required}, label = ${JSON.stringify(f.label)}::jsonb,
        help = ${f.help ? JSON.stringify(f.help) : null}::jsonb, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${id}::uuid returning id
    `);
    if (done.length === 0) return { ok: false, problems: ["This field is gone."] };
    await audit(member.account.id, storeId, "shipping.checkout_field_changed", { kind: f.kind, required: f.required }, { target: { type: "checkout_field", id } });
    return { ok: true, id };
  }
  const [count] = await db().execute(sql`select count(*)::int as n from commerce.checkout_fields where store_id = ${storeId}::uuid`);
  if (Number(count?.n ?? 0) >= FIELDS_MAX) return { ok: false, problems: [`A checkout asks at most ${FIELDS_MAX} questions.`] };
  const [row] = await db().execute(sql`
    insert into commerce.checkout_fields (store_id, kind, required, label, help, position)
    values (${storeId}::uuid, ${f.kind}, ${f.required}, ${JSON.stringify(f.label)}::jsonb, ${f.help ? JSON.stringify(f.help) : null}::jsonb,
      (select coalesce(max(position), -1) + 1 from commerce.checkout_fields where store_id = ${storeId}::uuid))
    returning id
  `);
  const made = String(row.id);
  await audit(member.account.id, storeId, "shipping.checkout_field_made", { kind: f.kind, required: f.required }, { target: { type: "checkout_field", id: made } });
  return { ok: true, id: made };
}

export async function switchCheckoutField(member: Membership, id: string, on: boolean): Promise<void> {
  const done = await db().execute(sql`
    update commerce.checkout_fields set enabled = ${on}, updated_at = now() where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id
  `);
  if (done.length > 0) await audit(member.account.id, member.store.id, on ? "shipping.checkout_field_on" : "shipping.checkout_field_off", {}, { target: { type: "checkout_field", id } });
}

export async function deleteCheckoutField(member: Membership, id: string): Promise<void> {
  const done = await db().execute(sql`delete from commerce.checkout_fields where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id`);
  if (done.length > 0) await audit(member.account.id, member.store.id, "shipping.checkout_field_deleted", {}, { target: { type: "checkout_field", id } });
}

/** Keeps the shopper's answers on the open cart (already checked by `cleanAnswers()`); `placeOrder()` copies them. */
export async function setCartAnswers(storeId: string, cartId: string, answers: unknown[]): Promise<void> {
  await db().execute(sql`
    update commerce.carts set checkout_answers = ${answers.length > 0 ? JSON.stringify(answers) : null}::jsonb, updated_at = now()
    where store_id = ${storeId}::uuid and id = ${cartId}::uuid and status = 'open'
  `);
}

/** What the checkout asks this cart (D357): the fields that are on, in the cart's language, and the answers the cart holds. */
export async function checkoutQuestionsFor(storeId: string, locale: string, cartId: string | null): Promise<{ fields: ShownField[]; answers: Record<string, string | boolean> }> {
  const fields = await listCheckoutFields(db(), storeId, { onlyOn: true });
  if (fields.length === 0) return { fields: [], answers: {} };
  const [cart] = cartId
    ? await db().execute(sql`select checkout_answers from commerce.carts where store_id = ${storeId}::uuid and id = ${cartId}::uuid`)
    : [];
  return { fields: fields.map((f) => shownField(f, locale)), answers: answersByField(cart?.checkout_answers) };
}

/** What the rule editor offers (D357): the store's delivery options in every country (named with the country), products, categories, tags, groups. */
export async function ruleChoices(storeId: string, locale: string) {
  const [options, products, terms, tiers] = await Promise.all([
    db().execute(sql`
      select 'method:' || id::text as id, market_code, name from commerce.shipping_methods where store_id = ${storeId}::uuid
      union all
      select 'pickup:' || po.id::text, po.market_code, l.name
      from commerce.pickup_options po join commerce.store_locations l on l.store_id = po.store_id and l.id = po.location_id
      where po.store_id = ${storeId}::uuid
      union all
      select 'local:' || id::text, market_code, name from commerce.local_delivery_areas where store_id = ${storeId}::uuid
      order by 2, 3
    `),
    db().execute(sql`
      select p.id, coalesce((select t.title from commerce.product_translations t where t.store_id = p.store_id and t.product_id = p.id
        order by (t.locale = ${locale}) desc, t.locale limit 1), p.handle) as title
      from commerce.products p where p.store_id = ${storeId}::uuid and p.status <> 'archived'
      order by 2 limit 500
    `),
    db().execute(sql`
      select id, kind, name from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' order by kind, position, name
    `),
    db().execute(sql`select id, name from commerce.customer_tiers where store_id = ${storeId}::uuid order by name`),
  ]);
  return {
    options: options.map((o) => ({ id: String(o.id), label: `${String(o.market_code).trim()} · ${String(o.name)}` })),
    products: products.map((p) => ({ id: String(p.id), label: String(p.title) })),
    categories: terms.filter((t) => t.kind === "category").map((t) => ({ id: String(t.id), label: String(t.name) })),
    tags: terms.filter((t) => t.kind === "tag").map((t) => ({ id: String(t.id), label: String(t.name) })),
    groups: tiers.map((t) => ({ id: String(t.id), label: String(t.name) })),
  };
}
