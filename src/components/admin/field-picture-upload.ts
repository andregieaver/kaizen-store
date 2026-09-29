import { uploadImageAction } from "@/app/admin/(gated)/[store]/products/actions";

import { shrinkAndUpload } from "./fields-form";

/** A picture for a custom field (D118): shrunk in the browser, kept in the store's media library. */
export function uploadFieldPicture(storeSlug: string, file: File) {
  return shrinkAndUpload(file, async (image, thumbnail) => {
    const data = new FormData();
    data.set("image", image);
    data.set("name", file.name);
    data.set("thumbnail", thumbnail);
    const outcome = await uploadImageAction(storeSlug, data);
    return outcome.ok
      ? { ok: true, url: outcome.url, thumbnailUrl: outcome.thumbnailUrl }
      : { ok: false, problem: outcome.problem };
  });
}
