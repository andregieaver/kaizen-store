"use client";

import { useState } from "react";

import { ImageUploadButton, type Upload } from "./image-upload";

/**
 * A store template's picture (D175): uploaded to Kaizen's media library like other platform pictures, or an address typed or pasted
 * from it. The form sends `pictureUrl`; the server checks it (`isStarterPicture()`).
 */
export function StarterPictureField({ initial, upload }: { initial: string | null; upload: Upload }) {
  const [url, setUrl] = useState(initial ?? "");
  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1 font-medium">
        Picture <span className="font-normal text-muted">(optional: an address on this site, or https://…)</span>
        <input
          name="pictureUrl"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          maxLength={2000}
          className="min-h-10 rounded-md border border-border bg-background px-3 font-normal"
        />
      </label>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- the picture as the cards show it
        <img src={url} alt="" className="aspect-video w-60 rounded-md border border-border object-cover" />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <ImageUploadButton upload={upload} label={url ? "Upload another picture" : "Upload a picture"} onUploaded={(image) => setUrl(image.url)} />
        {url && (
          <button type="button" onClick={() => setUrl("")} className="min-h-10 rounded-md border border-border px-3">
            Remove the picture
          </button>
        )}
      </div>
    </div>
  );
}
