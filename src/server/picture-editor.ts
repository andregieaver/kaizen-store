import "server-only";

import sharp from "sharp";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { EDIT_ACTIONS, editedFileName, editPrompt, needsBrief } from "@/lib/picture-edit";
import { BRIEF_MAX, BRIEF_MIN } from "@/lib/picture-direction";

import { AiError, aiFor, editImage, type AiConnection } from "./ai";
import { checkedAlt, shrinkPicture } from "./ai-pictures";
import { downloadStoredFile } from "./media";
import { storePicture } from "./media-library";
import type { PictureOwner } from "./picture-maker";

type Row = Record<string, unknown>;

/**
 * Editing a library picture with the site's AI (wave 8 unit E, D349, decision 3): the edit model named in the AI settings (*Model that edits
 * pictures*, `ai_providers.image_edit_model`) at the picture provider's `/images/edits`, given the library's own file read from Storage by its row
 * (never an address a person typed). The result is a new library item marked `ai_edited`, with `edited_from` the original's id; the original is
 * never overwritten. Metered `per_image` under the feature `picture_edit`. Who may edit is the route's to ask (`picture-route.ts`).
 */

/**
 * The picture by its library id (the library's *Edit with AI*), or by its address (a picture field's *Remove background* in the page builder,
 * which holds only the address): either way only a picture the site's own library holds, read from its row.
 */
const input = z
  .object({
    mediaId: z.uuid().optional(),
    url: z.url({ protocol: /^https?$/ }).max(1000).optional(),
    action: z.enum(EDIT_ACTIONS),
    brief: z.string().trim().max(BRIEF_MAX).default(""),
  })
  .refine((value) => Boolean(value.mediaId) !== Boolean(value.url), "Name the picture by its id or its address.");

export type EditedPicture =
  | { ok: true; picture: { id: string | null; url: string; thumbnailUrl: string | null; width: number; height: number; alt: string } }
  | { ok: false; problem: string };

/** Whether a site's AI has a model that edits pictures, so the library offers *Edit with AI*. */
export async function canEditPictures(storeId: string | null): Promise<boolean> {
  return Boolean((await aiFor(storeId))?.image?.editModel);
}

export async function editLibraryPicture(
  owner: PictureOwner,
  raw: unknown,
  deps: { connection?: AiConnection | null; read?: typeof downloadStoredFile; edit?: typeof editImage; store?: typeof storePicture } = {},
): Promise<EditedPicture> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "Choose a picture and an edit." };
  const { mediaId, url, action, brief } = parsed.data;
  if (needsBrief(action) && brief.length < BRIEF_MIN) return { ok: false, problem: `Describe it in ${BRIEF_MIN} to ${BRIEF_MAX} characters.` };
  const storeId = owner.store?.id ?? null;
  const connection = deps.connection !== undefined ? deps.connection : await aiFor(storeId, { feature: "picture_edit", accountId: owner.accountId });
  if (!connection?.image?.editModel) {
    return {
      ok: false,
      problem: owner.store
        ? "This store's AI has no model that edits pictures. Choose one under Settings, AI, to edit pictures."
        : "Kaizena Flow's AI has no model that edits pictures. Choose one in the platform's AI settings to edit pictures.",
    };
  }
  const [row] = await db().execute<Row>(sql`
    select id, bucket, path, alt, file_name from commerce.media
    where ${mediaId ? sql`id = ${mediaId}::uuid` : sql`url = ${url ?? ""}`} and kind = 'image' and ${storeId ? sql`store_id = ${storeId}::uuid` : sql`store_id is null`}
  `);
  if (!row) {
    return {
      ok: false,
      problem: mediaId ? "That picture is not in the library." : "This picture is not in the site's media library, so the AI cannot edit it. Upload it or choose it from the library first.",
    };
  }
  const bytes = await (deps.read ?? downloadStoredFile)(String(row.bucket), String(row.path));
  if (!bytes) return { ok: false, problem: "The picture's file could not be read." };
  let png: Uint8Array;
  try {
    // A PNG every edit endpoint takes, at most 1024 pixels on its longer side.
    png = new Uint8Array(await sharp(bytes, { failOn: "error" }).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).png().toBuffer());
  } catch {
    return { ok: false, problem: "The picture's file could not be read." };
  }
  let edited: Uint8Array;
  try {
    // A background taken away is asked for see-through (D413), where the model can be.
    edited = (await (deps.edit ?? editImage)(connection, { bytes: png, contentType: "image/png" }, editPrompt(action, brief), { transparent: action === "remove_background" })).bytes;
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { ok: false, problem: `The picture could not be edited: ${error.message}` };
  }
  let shrunk: Awaited<ReturnType<typeof shrinkPicture>>;
  try {
    shrunk = await shrinkPicture(edited, "edited");
  } catch {
    return { ok: false, problem: "The provider's picture could not be read." };
  }
  const name = editedFileName(String(row.file_name));
  const alt = checkedAlt(String(row.alt ?? ""));
  const stored = await (deps.store ?? storePicture)(
    { storeId, accountId: owner.accountId },
    new File([new Uint8Array(shrunk.image)], name, { type: "image/webp" }),
    new File([new Uint8Array(shrunk.thumbnail)], name.replace(/\.webp$/, "-480.webp"), { type: "image/webp" }),
    { fileName: name, alt, madeBy: "ai_edited", editedFrom: String(row.id), aiMarked: true },
  );
  if (!stored.ok) return { ok: false, problem: stored.problem };
  return { ok: true, picture: { id: stored.id ?? null, url: stored.url, thumbnailUrl: stored.thumbnailUrl, width: shrunk.width, height: shrunk.height, alt } };
}
