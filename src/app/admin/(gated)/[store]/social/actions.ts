"use server";

import { storeAction } from "@/server/store-action";
import { markSocialPostCopied, writeSocialPosts, type WriteResult } from "@/server/social-posts";

/** The social post creator's steps (D870 C1), the store's slug the bound first argument: writing and copying are `marketing:write`. */

export async function writeSocialPostsAction(storeSlug: string, input: unknown): Promise<WriteResult> {
  return storeAction({ store: storeSlug, key: "marketing:write", action: "marketing.social_posts_written", answer: (problem) => ({ ok: false, problem }) }, (member) =>
    writeSocialPosts(member, input),
  );
}

export async function socialPostCopiedAction(storeSlug: string, id: string): Promise<boolean> {
  return storeAction({ store: storeSlug, key: "marketing:write", action: "marketing.social_post_copied", answer: () => false }, (member) => markSocialPostCopied(member, String(id)));
}
