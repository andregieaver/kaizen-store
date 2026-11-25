import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { PICTURE_SIZES, POST_CHANNELS } from "@/lib/social-posts";
import { parseVisionVerdict, visionPrompt, type CheckSubject, type CheckVerdict } from "@/lib/social-vision";

import { aiFor, completeText, imagePart, seeing, type AiConnection } from "./ai";
import type { Membership } from "./auth";
import { listGridProducts } from "./catalog";
import { log } from "./log";
import { memberCan, NO_ACCESS } from "./permissions";
import { paletteOf, socialPicture } from "./social-pictures";
import { col, typedRows } from "./typed-rows";

/**
 * The vision check of a post's picture (D870 S2.3, the prompt and the reading of its answer in `src/lib/social-vision.ts`): the picture as it
 * will be posted (its own from Canva, else drawn: `socialPicture()`) sent as data to the store's model that sees pictures (`seeing()`),
 * metered as `social_posts`, the verdict kept on the post (`checked_at`, `check_problems`, `check_note`). The only writer of those columns.
 * A post the model gives no answer for is left unchecked, never failed.
 */

const POST = z.object({ id: col.uuid, channel: z.enum(POST_CHANNELS), product_id: z.string().nullable(), page_id: z.string().nullable(), topic: col.text });

export type CheckDeps = { connection?: AiConnection | null; picture?: (postId: string) => Promise<{ bytes: Uint8Array; type: string } | null> };

/** What the post is about, as the checker is told: the product's or page's title and words, or the topic. */
async function subjectOf(store: Membership["store"], post: z.infer<typeof POST>): Promise<CheckSubject> {
  const market = store.markets[0];
  if (post.product_id && market) {
    const [p] = await listGridProducts(store.id, market, { categoryIds: [], tagIds: [], sort: "given", limit: 1, ids: [post.product_id] });
    if (p) return { kind: "product", title: p.title, about: (p.excerpt || p.description).slice(0, 400) };
  }
  if (post.page_id) {
    const [page] = await typedRows(
      z.object({ title: col.text, about: col.text }),
      sql`select coalesce(nullif(published ->> 'title', ''), slug) as title, coalesce(published ->> 'description', '') as about
        from commerce.pages where store_id = ${store.id}::uuid and id = ${post.page_id}::uuid and published is not null`,
    );
    if (page) return { kind: "page", title: page.title, about: page.about };
  }
  return { kind: "topic", title: post.topic, about: "" };
}

/**
 * Checks the store's posts named (at most ten a call): each picture drawn, looked at and its verdict kept. The verdicts by post id; a post
 * the model gave no answer for is absent. Refused without the marketing permission or an AI that sees pictures.
 */
export async function checkSocialPosts(
  member: Membership,
  raw: unknown,
  origin: string,
  deps: CheckDeps = {},
): Promise<{ ok: true; checked: Record<string, CheckVerdict> } | { ok: false; problem: string }> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  const ids = z.array(z.uuid()).min(1).max(10).safeParse(raw);
  if (!ids.success) return { ok: false, problem: "Choose the posts to check." };
  const { store } = member;
  const connection = seeing(deps.connection === undefined ? await aiFor(store.id, { feature: "social_posts", accountId: member.account.id }) : deps.connection);
  if (!connection) return { ok: false, problem: "Checking pictures needs the store's AI with a model that sees pictures, set up under Settings." };
  const posts = await typedRows(
    POST,
    sql`select id, channel, product_id, page_id, topic from commerce.social_posts where store_id = ${store.id}::uuid and id = any(${`{${ids.data.join(",")}}`}::uuid[])`,
  );
  const palette = paletteOf(store);
  const picture =
    deps.picture ??
    (async (postId: string) => {
      const drawn = await socialPicture(member, postId, origin);
      if (!drawn.ok) return null;
      return { bytes: new Uint8Array(await drawn.response.arrayBuffer()), type: drawn.response.headers.get("content-type") ?? "image/png" };
    });
  const checked: Record<string, CheckVerdict> = {};
  for (const post of posts) {
    const file = await picture(post.id);
    if (!file) continue;
    const subject = await subjectOf(store, post);
    const prompt = visionPrompt({ shop: store.name, channel: post.channel, shape: PICTURE_SIZES[post.channel].shape, subject, colours: [palette.background, palette.text, palette.accent] });
    let verdict: CheckVerdict | null = null;
    try {
      const { text } = await completeText(
        connection,
        [
          { role: "system", content: prompt.system },
          { role: "user", content: [{ type: "text", text: prompt.user }, imagePart(connection, file.bytes, file.type)] },
        ],
        { maxTokens: 300, timeoutMs: 45_000, temperature: 0 },
      );
      verdict = parseVisionVerdict(text, subject.kind);
    } catch (error) {
      log("warn", "social.check_failed", { post: post.id }, error);
    }
    if (!verdict) continue;
    await db().execute(sql`
      update commerce.social_posts set checked_at = now(), check_problems = ${`{${verdict.problems.join(",")}}`}::text[], check_note = ${verdict.note}
      where store_id = ${store.id}::uuid and id = ${post.id}::uuid`);
    checked[post.id] = verdict;
  }
  return { ok: true, checked };
}
