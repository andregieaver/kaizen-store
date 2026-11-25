import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { todayIn } from "@/lib/analytics-period";
import { brandGuide } from "@/lib/brand";
import { RULES_STAND, UNTRUSTED_TEXT } from "@/lib/prompt-safety";
import { ADVICE_SHAPE, ADVISER_RULES, parseAdvice, type Advice } from "@/lib/social-advice";
import type { SocialFacts } from "@/lib/social-facts";

import { AiError, aiFor, chatWithTools, type ToolChatMessage } from "./ai";
import { audit, type Membership } from "./auth";
import { brandOf } from "./brand";
import { memberCan, NO_ACCESS } from "./permissions";
import { gatherSocialFacts } from "./social-facts";
import { LANGUAGE_NAMES } from "./social-posts";
import { col, typedRows } from "./typed-rows";

/**
 * The social media adviser (D870 S1.4, `docs/social-manager.md` 4, the answer's rules in `src/lib/social-advice.ts`): the store's AI reads
 * the facts (`gatherSocialFacts()`) and answers three verdicts, recommendations and a two-week calendar, in the store's main language and
 * brand. The answer is checked (`parseAdvice()`) and kept with the facts it was given, so the owner sees every figure beside the words.
 */


/** How many answers a store keeps. */
export const ADVICE_KEPT = 20;

export type KeptAdvice = { id: string; facts: SocialFacts; advice: Advice; createdAt: string };
export type AdviceResult = { ok: true; kept: KeptAdvice } | { ok: false; problem: string };

export async function writeSocialAdvice(member: Membership, options: { complete?: typeof chatWithTools; now?: Date } = {}): Promise<AdviceResult> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  const { store } = member;
  const now = options.now ?? new Date();
  const connection = await aiFor(store.id, { feature: "social_adviser", accountId: member.account.id });
  if (!connection?.textModel) return { ok: false, problem: "No AI with a text model is set up for this store." };
  const facts = await gatherSocialFacts(store, member.account.id, now);
  const brand = await brandOf(store.id);
  const guide = brandGuide(brand);
  const locale = store.localization.locales[0] ?? store.markets[0]?.locale ?? "en";
  const language = LANGUAGE_NAMES[locale.slice(0, 2)] ?? locale;
  const today = todayIn(now, store.timeZone);
  const messages: ToolChatMessage[] = [
    {
      role: "system",
      content: [
        `You are the social media adviser of the shop "${store.name}". Write in ${language}, plainly, to its owner.`,
        "From the facts given, say in three verdicts how the shop stands on social media, recommend what to do next (most important first, each tied to a goal or a fact), and plan posts for the coming two weeks.",
        "Prefer posts about the products in the facts' push list, and the new ones; put posts on the weekday that reaches most when the facts name one.",
        ADVISER_RULES,
        RULES_STAND,
        UNTRUSTED_TEXT,
        `Today is ${today}.`,
        ADVICE_SHAPE,
        ...(guide ? [`\n\n${guide}`] : []),
      ].join(" "),
    },
    { role: "user", content: `<facts>${JSON.stringify(facts).replace(/</g, "‹")}</facts>` },
  ];
  const chat = options.complete ?? chatWithTools;
  let advice: Advice | null;
  try {
    const reply = await chat(connection, messages, [], { maxTokens: 2500, timeoutMs: 90_000 });
    advice = parseAdvice(reply.content ?? "", facts, today, brand.avoid);
  } catch (error) {
    if (error instanceof AiError) return { ok: false, problem: "The AI did not answer. Try again in a moment." };
    throw error;
  }
  if (!advice) return { ok: false, problem: "The adviser's answer could not be used. Try again." };
  const [row] = await typedRows(
    z.object({ id: col.uuid, created_at: col.timestamp }),
    sql`
      insert into commerce.social_advice (store_id, facts, advice, created_by)
      values (${store.id}::uuid, ${JSON.stringify(facts)}::jsonb, ${JSON.stringify(advice)}::jsonb, ${member.account.id}::uuid)
      returning id, created_at
    `,
  );
  await db().execute(sql`
    delete from commerce.social_advice where store_id = ${store.id}::uuid and id not in (
      select id from commerce.social_advice where store_id = ${store.id}::uuid order by created_at desc limit ${ADVICE_KEPT})
  `);
  await audit(member.account.id, store.id, "store.social_advice_written", { recommendations: advice.recommendations.length, calendar: advice.calendar.length });
  return { ok: true, kept: { id: row.id, facts, advice, createdAt: row.created_at } };
}

/** The store's newest answer, or null before the first. */
export async function latestAdvice(storeId: string): Promise<KeptAdvice | null> {
  const [row] = await typedRows(
    z.object({ id: col.uuid, facts: z.unknown(), advice: z.unknown(), created_at: col.timestamp }),
    sql`select id, facts, advice, created_at from commerce.social_advice where store_id = ${storeId}::uuid order by created_at desc limit 1`,
  );
  if (!row) return null;
  // Written only by `writeSocialAdvice()` from checked objects; read back as they were kept.
  return { id: row.id, facts: row.facts as SocialFacts, advice: row.advice as Advice, createdAt: row.created_at };
}
