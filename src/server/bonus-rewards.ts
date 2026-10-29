import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { convertCredits } from "@/lib/bonus";
import { REWARDS_MAX, rewardCodeEnds, rewardName, type BonusReward, type RedeemedCode, type ShopperReward } from "@/lib/bonus-rewards";
import { rewardInput } from "@/lib/bonus-rewards-schema";
import { generatedCode } from "@/lib/discounts";

import { audit, type Membership } from "./auth";
import { bonusProgram, failedWith } from "./bonus";
import type { Shop } from "./cart";
import { log } from "./log";
import { col, typedRows } from "./typed-rows";

/**
 * Loyalty rewards (wave 13 unit A, D401, `docs/bonus.md` "Rewards and the birthday credit"): the only writer of `commerce.bonus_rewards` and of a
 * reward's own discount code (`discount_codes.reward`). A reward is a code of the store's, so what it takes off a basket is the code engine's
 * (`applyDiscount()` through `cartSummary()` and `placeOrder()`); redeeming is the signed-in customer's own press, which spends the reward's cost and
 * makes one generated code for them alone in one transaction (`commerce.bonus_redeem_reward()`).
 */

export type RewardSave = { ok: true; id: string } | { ok: false; problems: string[] };
export type Redeemed = { ok: true; code: string } | { ok: false; reason: "off" | "gone" | "short" };

const REWARD_ROW = z.object({
  id: col.uuid,
  name: col.text,
  names: z.record(z.string(), z.string()).catch({}),
  cost_minor: col.minor,
  kind: z.enum(["free_shipping", "product", "amount"]),
  product_id: col.uuid.nullable(),
  amounts: z.record(z.string(), z.number()).catch({}),
  active: col.bool,
});

const toReward = (r: z.output<typeof REWARD_ROW>): BonusReward => ({
  id: r.id,
  name: r.name,
  names: r.names,
  costMinor: r.cost_minor,
  kind: r.kind,
  productId: r.product_id,
  amounts: r.amounts,
  active: r.active,
});

/** The store's rewards, in their order, with the amounts off read from their codes. */
export async function listRewards(storeId: string): Promise<BonusReward[]> {
  const rows = await typedRows(
    REWARD_ROW,
    sql`
      select r.id, r.name, r.names, r.cost_minor, r.kind, r.product_id, d.amounts, r.active
      from commerce.bonus_rewards r
      join commerce.discount_codes d on d.store_id = r.store_id and d.id = r.discount_id
      where r.store_id = ${storeId}::uuid
      order by r.position, r.created_at
    `,
  );
  return rows.map(toReward);
}

/** What a reward's code is: free shipping, one unit of the product at 100 %, or an amount off per market. */
function codeShape(input: z.output<typeof rewardInput>) {
  return {
    kind: input.kind === "free_shipping" ? "free_shipping" : input.kind === "product" ? "percent" : "fixed",
    percent: input.kind === "product" ? 100 : 0,
    amounts: input.kind === "amount" ? input.amounts : {},
    productIds: input.kind === "product" ? [input.productId] : null,
    maxUnits: input.kind === "product" ? 1 : null,
  };
}

/**
 * Makes or changes a reward (`marketing:write`, checked by the action), and its code with it: the code's kind, product, amounts and whether it
 * works follow the reward, so a code already handed out takes off what the reward now says.
 */
export async function saveReward(member: Membership, id: string | null, raw: unknown): Promise<RewardSave> {
  const parsed = rewardInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const input = parsed.data;
  const storeId = member.store.id;
  const problems: string[] = [];
  if (input.kind === "product") {
    const [own] = await db().execute(sql`select 1 from commerce.products where store_id = ${storeId}::uuid and id = ${input.productId}::uuid`);
    if (!own) problems.push("Choose a product of this store.");
  }
  if (input.kind === "amount" && Object.keys(input.amounts).some((code) => !member.store.markets.some((m) => m.code === code))) {
    problems.push("Give amounts in the store's own countries.");
  }
  if (problems.length > 0) return { ok: false, problems };
  const shape = codeShape(input);
  const out = await db().transaction(async (tx): Promise<RewardSave> => {
    if (!id) {
      const [count] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from commerce.bonus_rewards where store_id = ${storeId}::uuid`);
      if (Number(count?.n ?? 0) >= REWARDS_MAX) return { ok: false, problems: [`A store can have at most ${REWARDS_MAX} rewards.`] };
      const code = `REWARD-${generatedCode("", (n) => new Uint8Array(randomBytes(n)))}`;
      const [discount] = await tx.execute<{ id: string }>(sql`
        insert into commerce.discount_codes (store_id, code, kind, percent, amounts, product_ids, active, unique_codes, combines_with, reward, max_units)
        values (${storeId}::uuid, ${code}, ${shape.kind}, ${shape.percent}, ${JSON.stringify(shape.amounts)}::jsonb, ${shape.productIds ? JSON.stringify(shape.productIds) : null}::jsonb,
                ${input.active}, true, '["products", "order", "shipping"]'::jsonb, true, ${shape.maxUnits})
        returning id
      `);
      const [reward] = await tx.execute<{ id: string }>(sql`
        insert into commerce.bonus_rewards (store_id, name, names, cost_minor, kind, product_id, discount_id, active, position, updated_by)
        values (${storeId}::uuid, ${input.name}, ${JSON.stringify(input.names)}::jsonb, ${input.costMinor}, ${input.kind}, ${input.productId}::uuid,
                ${discount.id}::uuid, ${input.active},
                (select coalesce(max(position), 0) + 1 from commerce.bonus_rewards where store_id = ${storeId}::uuid), ${member.account.id}::uuid)
        returning id
      `);
      return { ok: true, id: String(reward.id) };
    }
    const [reward] = await tx.execute<{ discount_id: string }>(sql`
      update commerce.bonus_rewards set name = ${input.name}, names = ${JSON.stringify(input.names)}::jsonb, cost_minor = ${input.costMinor},
        kind = ${input.kind}, product_id = ${input.productId}::uuid, active = ${input.active}, updated_by = ${member.account.id}::uuid, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${id}::uuid
      returning discount_id
    `);
    if (!reward) return { ok: false, problems: ["This reward is gone."] };
    await tx.execute(sql`
      update commerce.discount_codes set kind = ${shape.kind}, percent = ${shape.percent}, amounts = ${JSON.stringify(shape.amounts)}::jsonb,
        product_ids = ${shape.productIds ? JSON.stringify(shape.productIds) : null}::jsonb, max_units = ${shape.maxUnits}, active = ${input.active}, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${reward.discount_id}::uuid and reward
    `);
    return { ok: true, id };
  });
  if (out.ok) {
    await audit(member.account.id, storeId, id ? "discount.reward_updated" : "discount.reward_created", { kind: input.kind, costMinor: input.costMinor, active: input.active }, {
      area: "marketing",
      target: { type: "bonus_reward", id: out.id },
    });
  }
  return out;
}

/** Switches a reward on or off; its codes already handed out stop or start working with it. */
export async function switchReward(member: Membership, id: string, active: boolean): Promise<boolean> {
  const storeId = member.store.id;
  const done = await db().transaction(async (tx) => {
    const [reward] = await tx.execute<{ discount_id: string }>(sql`
      update commerce.bonus_rewards set active = ${active}, updated_by = ${member.account.id}::uuid, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${id}::uuid returning discount_id
    `);
    if (!reward) return false;
    await tx.execute(sql`update commerce.discount_codes set active = ${active}, updated_at = now() where store_id = ${storeId}::uuid and id = ${reward.discount_id}::uuid and reward`);
    return true;
  });
  if (!done) return false;
  await audit(member.account.id, storeId, "discount.reward_switched", { active }, { area: "marketing", target: { type: "bonus_reward", id } });
  return true;
}

/** The rewards a customer may redeem now, in their language, with costs in the currency shown and whether their usable credits cover each. */
export async function shopperRewards(shop: Shop, customerId: string | null): Promise<ShopperReward[]> {
  const program = await bonusProgram(db(), shop.storeId);
  if (!program.on) return [];
  const rewards = (await listRewards(shop.storeId)).filter((r) => r.active);
  if (rewards.length === 0) return [];
  let available = 0;
  if (customerId) {
    const [row] = await db().execute<{ available_minor: string | number }>(sql`
      select available_minor from commerce.bonus_balance(${shop.storeId}::uuid, ${customerId}::uuid)
    `);
    available = Number(row?.available_minor ?? 0);
  }
  const shown = (minor: number) => convertCredits(minor, program.currency, shop.market.currency, program.rates, "up") ?? minor;
  return rewards.map((r) => ({
    id: r.id,
    name: rewardName(r, shop.market.locale),
    kind: r.kind,
    costMinor: shown(r.costMinor),
    affordable: available >= r.costMinor,
  }));
}

/** The codes a customer redeemed, newest first, with whether each was used or has ended. */
export async function redeemedCodes(shop: Shop, customerId: string): Promise<RedeemedCode[]> {
  const rows = await typedRows(
    z.object({ code: col.text, name: col.text, names: z.record(z.string(), z.string()).catch({}), ends_at: col.timestampOrNull, used: col.bool, active: col.bool }),
    sql`
      select i.code, r.name, r.names, i.ends_at, d.active,
        exists (select 1 from commerce.orders o
                where o.store_id = i.store_id and o.status <> 'cancelled' and o.copied_from is null
                  and (o.discount_code_item_id = i.id or exists (select 1 from commerce.order_discount_codes x
                       where x.store_id = o.store_id and x.order_id = o.id and x.item_id = i.id))) as used
      from commerce.discount_code_items i
      join commerce.discount_codes d on d.store_id = i.store_id and d.id = i.discount_id and d.reward
      join commerce.bonus_rewards r on r.store_id = d.store_id and r.discount_id = d.id
      where i.store_id = ${shop.storeId}::uuid and i.customer_id = ${customerId}::uuid
      order by i.created_at desc
      limit 50
    `,
  );
  const now = Date.now();
  return rows.map((r) => ({
    code: r.code,
    rewardName: rewardName({ name: r.name, names: r.names }, shop.market.locale),
    endsAt: r.ends_at,
    used: r.used,
    ended: !r.active || (r.ends_at !== null && new Date(r.ends_at).getTime() <= now),
  }));
}

/**
 * The customer's press: spends the reward's cost from their usable credits and makes their code, in one transaction under their ledger lock. The
 * code's text is new in the store; a clash with another code (rare) is tried again with a new one.
 */
export async function redeemReward(shop: Shop, customerId: string, rewardId: string): Promise<Redeemed> {
  const program = await bonusProgram(db(), shop.storeId);
  if (!program.on) return { ok: false, reason: "off" };
  const endsAt = rewardCodeEnds(new Date(), program.settings.expiresMonths);
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generatedCode("", (n) => new Uint8Array(randomBytes(n)));
    try {
      await db().execute(sql`
        select commerce.bonus_redeem_reward(${shop.storeId}::uuid, ${customerId}::uuid, ${rewardId}::uuid, ${randomUUID()}::uuid, ${code}, ${endsAt.toISOString()}::timestamptz)
      `);
      log("info", "bonus.reward_redeemed", { storeId: shop.storeId, rewardId });
      return { ok: true, code };
    } catch (error) {
      if (failedWith(error, "bonus.insufficient")) return { ok: false, reason: "short" };
      if (failedWith(error, "bonus.off")) return { ok: false, reason: "off" };
      if (failedWith(error, "bonus.reward_gone") || failedWith(error, "bonus.customer")) return { ok: false, reason: "gone" };
      const code23505 = (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
      if (code23505 === "23505" || failedWith(error, "discount_code")) continue;
      throw error;
    }
  }
  throw new Error("bonus-rewards: no free code text after three tries");
}

/** A customer's birthday as month and day (`MM-DD`), or none; a change starts the 30-day wait again (D401). */
export async function saveBirthday(storeId: string, customerId: string, birthday: string | null): Promise<boolean> {
  if (birthday !== null && !/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(birthday)) return false;
  const [month, day] = birthday ? birthday.split("-").map(Number) : [0, 0];
  if (birthday && day > new Date(Date.UTC(2024, month, 0)).getUTCDate()) return false;
  await db().execute(sql`
    update commerce.customers
    set birthday = ${birthday},
        birthday_set_at = case when birthday is distinct from ${birthday} then now() else birthday_set_at end
    where store_id = ${storeId}::uuid and id = ${customerId}::uuid
  `);
  return true;
}

/** The customer's birthday as month and day (`MM-DD`), or null. */
export async function customerBirthday(storeId: string, customerId: string): Promise<string | null> {
  const [row] = await db().execute<{ birthday: string | null }>(sql`
    select birthday from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid
  `);
  return row?.birthday ?? null;
}
