"use client";

import { useState, type ComponentProps } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { useAdminText } from "@/components/admin/admin-text";
import { ImageUploadButton, type Upload } from "@/components/admin/image-upload";
import { AUTHOR_BIO_MAX, AUTHOR_LINK_MAX, AUTHOR_NAME_MAX, type BlogAuthor } from "@/lib/blogs";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const button = "min-h-10 rounded-pill border border-edge px-3 text-sm";

/**
 * An author of a store's articles (D341): name, a picture uploaded into the store's media library, a few words and a link. Saved by the
 * page's action through `saveAuthor()`, which checks the picture is the library's and the link is a safe address.
 */
export function BlogAuthorForm({
  author,
  upload,
  save,
  cancelHref,
}: {
  author: BlogAuthor | null;
  upload: Upload | null;
  save: ComponentProps<typeof ActionForm>["action"];
  cancelHref: string;
}) {
  const w = useAdminText("blog").authors;
  const [picture, setPicture] = useState<string | null>(author?.picture ?? null);
  return (
    <ActionForm action={save} className="flex max-w-2xl flex-col gap-4">
      {author && <input type="hidden" name="id" value={author.id} />}
      <input type="hidden" name="picture" value={picture ?? ""} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.name}
        <input name="name" required defaultValue={author?.name ?? ""} maxLength={AUTHOR_NAME_MAX} className={input} />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{w.picture}</legend>
        <div className="flex flex-wrap items-center gap-3">
          {picture ? (
            // eslint-disable-next-line @next/next/no-img-element -- the store's own small picture
            <img src={picture} alt="" className="size-16 rounded-full object-cover" />
          ) : (
            <span className="text-caption text-muted">{w.noPicture}</span>
          )}
          <ImageUploadButton upload={upload} label={picture ? w.replacePicture : w.addPicture} make={false} onUploaded={(image) => setPicture(image.url)} />
          {picture && (
            <button type="button" onClick={() => setPicture(null)} className={button}>
              {w.removePicture}
            </button>
          )}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.bio}
        <textarea name="bio" rows={3} defaultValue={author?.bio ?? ""} maxLength={AUTHOR_BIO_MAX} className={`${input} py-2`} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.link}
        <input name="link" defaultValue={author?.link ?? ""} maxLength={AUTHOR_LINK_MAX} className={input} inputMode="url" />
        <span className="text-caption font-normal text-muted">{w.linkHint}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{w.save}</SubmitButton>
        {author && (
          <a href={cancelHref} className={button + " inline-flex items-center"}>
            {w.cancel}
          </a>
        )}
      </div>
    </ActionForm>
  );
}
