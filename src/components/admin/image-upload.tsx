"use client";

import { useState } from "react";

import { shrinkImage } from "@/lib/image-resize";

export type Upload = (data: FormData) => Promise<{ ok: true; url: string } | { ok: false; problem: string }>;

export type Uploaded = { url: string; width: number; height: number };

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

  const choose = async (file: File | undefined) => {
    if (!file || !upload) return;
    setBusy(true);
    setProblem(null);
    try {
      const [image, thumbnail] = await Promise.all([shrinkImage(file, 1600), shrinkImage(file, 480)]);
      const size = await createImageBitmap(image);
      const ext = image.type === "image/webp" ? "webp" : "jpg";
      const data = new FormData();
      data.set("image", new File([image], `picture.${ext}`, { type: image.type }));
      data.set("thumbnail", new File([thumbnail], `picture-480.${ext}`, { type: thumbnail.type }));
      const outcome = await upload(data);
      if (outcome.ok) onUploaded({ url: outcome.url, width: size.width, height: size.height });
      else setProblem(outcome.problem);
      size.close();
    } catch {
      setProblem(`${file.name} could not be read as a picture. Use a JPEG, PNG or WebP.`);
    } finally {
      setBusy(false);
    }
  };

  if (!upload) return <p className="text-sm text-muted">Uploads are not set up on this server.</p>;
  return (
    <div className="flex flex-col gap-2">
      <label className="w-fit cursor-pointer rounded-md border border-border px-3 py-2 text-sm focus-within:outline-2">
        {busy ? "Uploading …" : label}
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
      {problem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  );
}
