"use client";

import { useState } from "react";

import { compressPicture, extensionOf } from "@/lib/image-compress";
import { savingWords } from "@/lib/image-quality";

import { LibraryButton } from "./media-picker";

export type Upload = (data: FormData) => Promise<{ ok: true; url: string } | { ok: false; problem: string }>;

export type Uploaded = { url: string; width: number; height: number };

/** What compressing saved (D213): the file's size as chosen and as uploaded. */
export type Saving = { before: number; after: number };

/**
 * Compresses a picture in the browser (1600 px, with a 480 px thumbnail; the smallest that still looks the same, AVIF where
 * it is clearly smaller, D213) and uploads it; also used for a background video's first picture.
 */
export async function uploadPicture(
  upload: Upload,
  file: File,
): Promise<{ ok: true; image: Uploaded; saving: Saving } | { ok: false; problem: string }> {
  const [image, thumbnail] = await Promise.all([compressPicture(file, 1600, { avif: true }), compressPicture(file, 480)]);
  const data = new FormData();
  data.set("image", new File([image.blob], `picture.${extensionOf(image.type)}`, { type: image.type }));
  // Its name as it was on the owner's computer, for the media library (D88).
  data.set("name", file.name);
  data.set("thumbnail", new File([thumbnail.blob], `picture-480.${extensionOf(thumbnail.type)}`, { type: thumbnail.type }));
  // Compressed until it was as small as it could be while it looked the same (D213).
  data.set("compressed", "1");
  const outcome = await upload(data);
  if (!outcome.ok) return outcome;
  return { ok: true, image: { url: outcome.url, width: image.width, height: image.height }, saving: { before: file.size, after: image.blob.size } };
}

/**
 * Chooses a picture, shrinks it in the browser (1600 px, with a 480 px
 * thumbnail) and uploads it, as product and page pictures are.
 */
export function ImageUploadButton({
  upload,
  label,
  onUploaded,
}: {
  upload: Upload | null;
  label: string;
  onUploaded: (image: Uploaded) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file || !upload) return;
    setBusy(true);
    setProblem(null);
    setSaved(null);
    try {
      const outcome = await uploadPicture(upload, file);
      if (outcome.ok) {
        onUploaded(outcome.image);
        setSaved(savingWords(outcome.saving.before, outcome.saving.after));
      } else setProblem(outcome.problem);
    } catch {
      setProblem(`${file.name} could not be read as a picture. Use a JPEG, PNG, WebP or AVIF.`);
    } finally {
      setBusy(false);
    }
  };

  // A library to choose from (D88) works without uploads being set up.
  const library = <LibraryButton onPicked={(picture) => onUploaded({ url: picture.url, width: picture.width, height: picture.height })} />;
  if (!upload) return <div className="flex flex-col gap-2"><p className="text-sm text-muted">Uploads are not set up on this server.</p>{library}</div>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
      <label className="w-fit cursor-pointer rounded-md border border-line px-3 py-2 text-sm focus-within:outline-2">
        {busy ? "Compressing and uploading …" : label}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      {library}
      </div>
      {saved && (
        <p role="status" className="text-xs text-muted">
          {saved}, and it looks the same.
        </p>
      )}
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
    </div>
  );
}
