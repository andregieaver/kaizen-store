"use client";

import { useState } from "react";

import { startModelUploadAction, startVideoUploadAction } from "@/app/admin/(gated)/[store]/products/actions";
import { fillWords } from "@/lib/admin-fill";
import type { AdminAreaMessages } from "@/lib/admin-text";
import type { ProductInput } from "@/lib/product-input";
import { MAX_MODELS, MAX_VIDEOS, MODEL_MAX_BYTES, MODEL_MAX_MB, MODEL_TYPE, type UploadPoster } from "@/lib/product-media";
import { createClient } from "@/lib/supabase/client";
import { embedUrl, youtubeId } from "@/lib/video-embed";

import { takeStill, uploadVideoFile } from "./video-upload";

type Item = ProductInput["media"][number];
type Words = AdminAreaMessages["product"]["media"];

const field = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/** What an item is, in the editor's words: nothing for a picture. */
export function kindWords(item: Item, w: Words): string | null {
  if (item.kind === "model") return w.kinds.model;
  if (item.kind !== "video") return null;
  return item.source === "youtube" ? w.kinds.youtube : item.source === "vimeo" ? w.kinds.vimeo : w.kinds.video;
}

/**
 * Adding a video or a 3D model to a product's gallery (D325): a video is uploaded (compressed in the browser, D213, with a still from it
 * as its picture) or a YouTube or Vimeo address with a picture the owner chooses (nothing is fetched from YouTube or Vimeo); a model is
 * one GLB file with a picture. Each new item is handed to `onAdd`, saved with the product.
 */
export function AddMedia({
  storeSlug,
  media,
  onAdd,
  uploadPoster,
  words: w,
}: {
  storeSlug: string;
  media: ProductInput["media"];
  onAdd: (item: Item) => void;
  uploadPoster: UploadPoster;
  words: Words;
}) {
  const [open, setOpen] = useState<"video" | "model" | null>(null);
  const videos = media.filter((m) => m.kind === "video").length;
  const models = media.filter((m) => m.kind === "model").length;
  const add = (item: Item) => {
    onAdd(item);
    setOpen(null);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {videos < MAX_VIDEOS && open !== "video" && (
          <button type="button" onClick={() => setOpen("video")} className="min-h-10 rounded-pill border border-edge bg-card px-4 text-sm">
            {w.addVideo}
          </button>
        )}
        {models < MAX_MODELS && open !== "model" && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">{w.more}</summary>
            <button type="button" onClick={() => setOpen("model")} className="mt-2 min-h-10 rounded-pill border border-edge bg-card px-4 text-sm">
              {w.addModel}
            </button>
          </details>
        )}
      </div>
      {open === "video" && <AddVideo storeSlug={storeSlug} onAdd={add} onCancel={() => setOpen(null)} uploadPoster={uploadPoster} w={w} />}
      {open === "model" && <AddModel storeSlug={storeSlug} onAdd={add} onCancel={() => setOpen(null)} uploadPoster={uploadPoster} w={w} />}
    </div>
  );
}

/** A picture to show first: chosen from the owner's computer and uploaded as the editor uploads pictures. */
function PosterField({ label, onPoster, uploadPoster, w }: { label: string; onPoster: (poster: { url: string; thumbnailUrl: string } | null) => void; uploadPoster: UploadPoster; w: Words }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        type="file"
        accept="image/*"
        disabled={busy}
        className="text-sm"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setProblem(null);
          const outcome = await uploadPoster(file);
          setBusy(false);
          if ("problem" in outcome) {
            setProblem(outcome.problem);
            onPoster(null);
          } else {
            setChosen(outcome.thumbnailUrl);
            onPoster(outcome);
          }
        }}
      />
      {busy && <span className="text-muted">{w.working}</span>}
      {chosen && (
        // eslint-disable-next-line @next/next/no-img-element -- admin preview of an uploaded file
        <img src={chosen} alt="" className="size-20 rounded-md border border-line object-cover" />
      )}
      {problem && (
        <span role="alert" className="text-danger-text">
          {problem}
        </span>
      )}
    </label>
  );
}

function AddVideo({ storeSlug, onAdd, onCancel, uploadPoster, w }: { storeSlug: string; onAdd: (item: Item) => void; onCancel: () => void; uploadPoster: UploadPoster; w: Words }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [poster, setPoster] = useState<{ url: string; thumbnailUrl: string } | null>(null);

  const upload = async (file: File) => {
    setProblem(null);
    setBusy(w.working);
    // The product's video keeps its sound: shoppers start it themselves.
    const outcome = await uploadVideoFile((f) => startVideoUploadAction(storeSlug, f), null, file, {
      keepSound: true,
      onProgress: (progress) => setBusy(progress < 1 ? `${w.working} ${Math.round(progress * 100)} %` : w.working),
    });
    if (!outcome.ok) {
      setBusy(null);
      return setProblem(outcome.problem);
    }
    const still = await takeStill(file);
    const picture = still ? await uploadPoster(still) : null;
    setBusy(null);
    if (!picture || "problem" in picture) return setProblem(w.noStill);
    onAdd({ kind: "video", source: "upload", mediaUrl: outcome.video.video.url, url: picture.url, thumbnailUrl: picture.thumbnailUrl, alt: "", alts: {} });
  };

  const addLink = () => {
    const address = link.trim();
    const source = youtubeId(address) ? "youtube" : embedUrl("vimeo", address) ? "vimeo" : null;
    if (!source) return setProblem(w.notVideoLink);
    if (!poster) return setProblem(w.needPoster);
    onAdd({ kind: "video", source, mediaUrl: address, url: poster.url, thumbnailUrl: poster.thumbnailUrl, alt: "", alts: {} });
  };

  return (
    <div className="flex flex-col gap-3 rounded-panel border border-line bg-sunken p-4">
      <label className="flex flex-col gap-1 text-sm">
        {w.videoFile}
        <input
          type="file"
          accept="video/mp4,video/webm"
          disabled={busy !== null}
          className="text-sm"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />
      </label>
      {busy && <p className="text-sm text-muted">{busy}</p>}
      <div className="flex flex-col gap-3 border-t border-line pt-3">
        <label className="flex flex-col gap-1 text-sm">
          {w.videoLink}
          <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" className={field} />
        </label>
        <PosterField label={w.poster} onPoster={setPoster} uploadPoster={uploadPoster} w={w} />
        <div className="flex gap-2">
          <button type="button" onClick={addLink} disabled={busy !== null} className="min-h-10 rounded-pill bg-brand px-4 text-sm text-brand-ink disabled:opacity-40">
            {w.addLink}
          </button>
          <button type="button" onClick={onCancel} className="min-h-10 rounded-pill border border-edge bg-card px-4 text-sm">
            {w.cancel}
          </button>
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
    </div>
  );
}

function AddModel({ storeSlug, onAdd, onCancel, uploadPoster, w }: { storeSlug: string; onAdd: (item: Item) => void; onCancel: () => void; uploadPoster: UploadPoster; w: Words }) {
  const [file, setFile] = useState<File | null>(null);
  const [poster, setPoster] = useState<{ url: string; thumbnailUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = (chosen: File | undefined) => {
    setProblem(null);
    if (!chosen) return setFile(null);
    // A GLB's type is often not known to the browser: the file's name says it.
    if (!/\.glb$/i.test(chosen.name)) return setProblem(w.modelType);
    if (chosen.size > MODEL_MAX_BYTES) return setProblem(fillWords(w.modelTooLarge, { mb: MODEL_MAX_MB }));
    setFile(chosen);
  };

  const add = async () => {
    if (!file) return setProblem(w.needModel);
    if (!poster) return setProblem(w.needPoster);
    setBusy(true);
    setProblem(null);
    const started = await startModelUploadAction(storeSlug, { name: file.name, type: MODEL_TYPE, size: file.size });
    if (!started.ok) {
      setBusy(false);
      return setProblem(started.problem);
    }
    const stored = await createClient().storage.from(started.bucket).uploadToSignedUrl(started.path, started.token, file, { contentType: MODEL_TYPE });
    setBusy(false);
    if (stored.error) return setProblem(fillWords(w.uploadFailed, { name: file.name }));
    onAdd({ kind: "model", source: null, mediaUrl: started.url, url: poster.url, thumbnailUrl: poster.thumbnailUrl, alt: "", alts: {} });
  };

  return (
    <div className="flex flex-col gap-3 rounded-panel border border-line bg-sunken p-4">
      <label className="flex flex-col gap-1 text-sm">
        {w.modelFile}
        <input type="file" accept=".glb,model/gltf-binary" disabled={busy} className="text-sm" onChange={(e) => choose(e.target.files?.[0])} />
      </label>
      <PosterField label={w.modelPoster} onPoster={setPoster} uploadPoster={uploadPoster} w={w} />
      <div className="flex gap-2">
        <button type="button" onClick={() => void add()} disabled={busy} className="min-h-10 rounded-pill bg-brand px-4 text-sm text-brand-ink disabled:opacity-40">
          {busy ? w.working : w.add3d}
        </button>
        <button type="button" onClick={onCancel} className="min-h-10 rounded-pill border border-edge bg-card px-4 text-sm">
          {w.cancel}
        </button>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
    </div>
  );
}

/** An item's words in the store's other languages, one step away (Lisa's): empty takes the product's title there. */
export function OtherLanguageWords({
  item,
  locales,
  names,
  onChange,
  w,
}: {
  item: Item;
  locales: string[];
  names: Record<string, string>;
  onChange: (alts: Record<string, string>) => void;
  w: Words;
}) {
  if (locales.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted">{w.otherLanguages}</summary>
      <div className="mt-2 flex flex-col gap-2">
        {locales.map((locale) => (
          <label key={locale} className="flex flex-col gap-1">
            {names[locale] ?? locale}
            <input
              value={item.alts[locale] ?? ""}
              maxLength={300}
              onChange={(e) => onChange({ ...item.alts, [locale]: e.target.value })}
              placeholder={w.altPlaceholder}
              className={`${field} min-h-9 text-xs`}
            />
          </label>
        ))}
      </div>
    </details>
  );
}
