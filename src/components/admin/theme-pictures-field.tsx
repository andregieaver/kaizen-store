"use client";

import { useState } from "react";

import { fillWords } from "@/lib/admin-fill";
import { useAdminText } from "./admin-text";
import { ImageUploadButton, type Upload } from "./image-upload";

/**
 * A theme's pictures beside its main one, for its page in the theme store (`docs/theme-phase-3.md`): uploaded to Kaizena Flow's media
 * library or an address pasted, in order, at most `max`. The form sends each as `pictures`; the server checks them (`parseListing()`).
 */
export function ThemePicturesField({ initial, upload, max }: { initial: string[]; upload: Upload; max: number }) {
  const f = useAdminText("platformSite").fields;
  const [pictures, setPictures] = useState(initial);
  const [typed, setTyped] = useState("");
  const add = (url: string) => setPictures((list) => (url && !list.includes(url) && list.length < max ? [...list, url] : list));
  const move = (index: number, by: number) =>
    setPictures((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
      return next;
    });
  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="mb-1 font-medium">
        {f.more} <span className="font-normal text-muted">{fillWords(f.moreHint, { max })}</span>
      </legend>
      {pictures.map((url) => (
        <input key={url} type="hidden" name="pictures" value={url} />
      ))}
      {pictures.length > 0 && (
        <ol className="flex flex-wrap gap-3">
          {pictures.map((url, index) => (
            <li key={url} className="flex w-44 flex-col gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- the picture as its page shows it */}
              <img src={url} alt="" className="aspect-video w-full rounded-md border border-line object-cover" />
              <div className="flex flex-wrap gap-1">
                <button type="button" disabled={index === 0} onClick={() => move(index, -1)} className="min-h-8 rounded-pill border border-edge px-2 disabled:opacity-50">
                  {f.earlier}<span className="sr-only"> ({fillWords(f.pictureN, { n: index + 1 })})</span>
                </button>
                <button type="button" disabled={index === pictures.length - 1} onClick={() => move(index, 1)} className="min-h-8 rounded-pill border border-edge px-2 disabled:opacity-50">
                  {f.later}<span className="sr-only"> ({fillWords(f.pictureN, { n: index + 1 })})</span>
                </button>
                <button type="button" onClick={() => setPictures((list) => list.filter((item) => item !== url))} className="min-h-8 rounded-pill border border-edge px-2">
                  {f.remove}<span className="sr-only"> {fillWords(f.pictureN, { n: index + 1 })}</span>
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {pictures.length < max && (
        <div className="flex flex-wrap items-end gap-3">
          <ImageUploadButton upload={upload} label={f.upload} onUploaded={(image) => add(image.url)} />
          <label className="flex flex-col gap-1">
            <span>{f.orAddress}</span>
            <input value={typed} onChange={(event) => setTyped(event.target.value)} maxLength={2000} placeholder="/… or https://…" className="min-h-10 rounded-md border border-line bg-card px-3" />
          </label>
          <button
            type="button"
            onClick={() => {
              add(typed.trim());
              setTyped("");
            }}
            className="min-h-10 rounded-pill border border-edge px-3"
          >
            {f.addAddress}
          </button>
        </div>
      )}
    </fieldset>
  );
}
