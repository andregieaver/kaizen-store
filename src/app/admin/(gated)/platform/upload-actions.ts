"use server";

import { z } from "zod";

import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { startVideoUpload, type UploadResult, type VideoUpload } from "@/server/media";
import { forgetUnstoredVideo, registerVideo, uploadToLibrary } from "@/server/media-library";
import { platformAction } from "@/server/store-action";

/*
 * Kaizena Flow's uploads to its media library (D88), apart from the platform's other actions (D878): the page editors, the menus and the
 * other screens that take a picture import only these, so they no longer reach `actions.ts` and what it brings (self sign-up, the AI
 * manager and their words: about 850 KB of catalogues for the article editor, `admin-text-reach.scan.test.ts`).
 */

/** A refusal or failure, as both uploads answer it. */
const problem = (message: string) => ({ ok: false as const, problem: message });

/** Uploads a picture to Kaizena Flow's media library. */
export async function uploadPlatformImageAction(formData: FormData): Promise<UploadResult> {
  return platformAction({ area: "website", action: "platform.image_upload", answer: problem }, async (admin) =>
    // Kept in Kaizen's media library too (D88).
    uploadToLibrary({ storeId: null, accountId: admin.id }, formData),
  );
}

/** Starts an upload of a row's background video on Kaizen's pages, straight from the browser to the public bucket. */
export async function startPlatformVideoUploadAction(file: unknown): Promise<VideoUpload> {
  return platformAction({ area: "website", action: "platform.video_upload", answer: problem }, async (admin, lang) => {
    const parsed = z
      .object({
        name: z.string().max(255).optional(),
        type: z.string().max(100),
        size: z.number().int().nonnegative(),
        compressed: z.boolean().optional(),
        /** The path an earlier start gave, when the browser's upload to it never arrived (D536). */
        abandoned: z.string().max(300).optional(),
      })
      .safeParse(file);
    if (!parsed.success) return problem(PLATFORM_WORDS[lang].actions.chooseAVideoToUpload);
    if (parsed.data.abandoned !== undefined) {
      await forgetUnstoredVideo({ storeId: null }, parsed.data.abandoned);
      return problem("");
    }
    const started = await startVideoUpload("platform", parsed.data);
    // Kept in Kaizen's media library as its upload starts (D88).
    if (started.ok) await registerVideo({ storeId: null, accountId: admin.id }, started, parsed.data);
    return started;
  });
}
