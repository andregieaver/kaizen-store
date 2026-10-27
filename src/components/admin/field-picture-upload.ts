import { uploadImageAction } from "@/app/admin/(gated)/[store]/products/actions";

import type { UploadResult } from "@/server/media";

import { shrinkAndUpload } from "./fields-form";

/** An owner's own picture upload action, bound to a store or Kaizena Flow's own site. */
export type UploadPictureAction = (data: FormData) => Promise<UploadResult>;

/** A picture for a custom field (D118): shrunk in the browser, kept in the store's media library. */
export function uploadFieldPicture(storeSlug: string, file: File) {
  return uploadPictureWith((data) => uploadImageAction(storeSlug, data), file);
}

/** A picture for a field, shrunk in the browser and sent to an owner's own upload action (a store's, or Kaizena Flow's own site's, D326). */
export function uploadPictureWith(action: UploadPictureAction, file: File) {
  return shrinkAndUpload(file, async (image, thumbnail) => {
    const data = new FormData();
    data.set("image", image);
    data.set("name", file.name);
    data.set("thumbnail", thumbnail);
    const outcome = await action(data);
    return outcome.ok
      ? { ok: true, url: outcome.url, thumbnailUrl: outcome.thumbnailUrl }
      : { ok: false, problem: outcome.problem };
  });
}
