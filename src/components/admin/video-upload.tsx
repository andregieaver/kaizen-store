"use client";

import { useState } from "react";

import { savingWords } from "@/lib/image-quality";
import { createClient } from "@/lib/supabase/client";
import { putWithRetry } from "@/lib/upload-retry";
import { canCompressVideo, compressVideo, VIDEO_CHOOSE_MAX_BYTES, VIDEO_MAX_BYTES } from "@/lib/video-compress";

import { uploadPicture, type Saving, type Upload, type Uploaded } from "./image-upload";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import type { CommonMessages } from "@/lib/admin-messages/common.en";

/**
 * Starts a video's upload: a signed upload to the public bucket and the address it will have. Called again with
 * `abandoned` (the path it gave) when the file never arrived, so the media library forgets the video it had kept (D536).
 */
export type StartVideo = (file: { name?: string; type: string; size: number; compressed?: boolean; abandoned?: string }) => Promise<
  { ok: true; path: string; token: string; bucket: string; url: string } | { ok: false; problem: string }
>;

export type UploadedVideo = { video: { url: string }; poster: Uploaded | null };

const VIDEO_TYPES = ["video/mp4", "video/webm"];
/** How long taking a still may take before the upload goes on without one. */
const STILL_WAIT_MS = 8000;

/**
 * A still from early in the video, as a picture: shown until the video
 * plays, and instead of it for people who prefer less motion. Null when
 * this browser cannot play the video to take one.
 */
export function takeStill(file: File): Promise<File | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const done = (still: File | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(still);
    };
    // A browser that neither plays the file nor says it cannot must not hold the upload up for ever.
    const timer = setTimeout(() => done(null), STILL_WAIT_MS);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onerror = () => done(null);
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, (video.duration || 0) / 10);
    };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context || !canvas.width || !canvas.height) return done(null);
      context.drawImage(video, 0, 0);
      canvas.toBlob((blob) => done(blob ? new File([blob], "still.png", { type: "image/png" }) : null), "image/png");
    };
    video.src = url;
  });
}

/**
 * Compresses a video in the browser where it can (D213, `compressVideo()`: at most 1080p, without its sound where
 * `keepSound` is false, used only when clearly smaller) and uploads it straight from the browser to Storage (after the
 * server starts it, which keeps it in the media library, D88), with a still from it as its poster where `upload` is given.
 * A video larger than may be stored is accepted while this browser can compress it, and refused if it is still too large.
 * What is sent is held in this tab's memory first and sent twice if the first try does not arrive (D536, `putWithRetry()`):
 * a phone can lose its hold on a chosen file between choosing and sending, and then nothing leaves it. A video that never
 * arrived is taken out of the media library again.
 */
/** The words an upload says (`common.ui`), in the account's language: each caller hands in `useAdminText("common").ui`. */
export type UploadWords = CommonMessages["ui"];

export async function uploadVideoFile(
  startVideo: StartVideo,
  upload: Upload | null,
  chosen: File,
  options: { keepSound?: boolean; onProgress?: (progress: number) => void; words: UploadWords },
): Promise<{ ok: true; video: UploadedVideo; saving: Saving } | { ok: false; problem: string }> {
  const w = options.words;
  if (!VIDEO_TYPES.includes(chosen.type)) return { ok: false, problem: w.videoType };
  const compressing = await canCompressVideo();
  if (chosen.size > (compressing ? VIDEO_CHOOSE_MAX_BYTES : VIDEO_MAX_BYTES)) {
    return { ok: false, problem: fillWords(w.videoTooLarge, { mb: compressing ? 500 : 50 }) };
  }
  try {
    const compressed = compressing ? await compressVideo(chosen, { keepSound: options.keepSound ?? true, onProgress: options.onProgress }) : null;
    if ((compressed?.file ?? chosen).size > VIDEO_MAX_BYTES) return { ok: false, problem: w.videoTooLargeCompressed };
    const file = compressed?.file ?? (await heldInMemory(chosen));
    if (!file) return { ok: false, problem: fillWords(w.notUploaded, { name: chosen.name }) };
    const [sent, still] = await Promise.all([
      sendVideo(startVideo, file, { name: chosen.name, compressed: compressed !== null }),
      upload ? takeStill(file) : Promise.resolve(null),
    ]);
    if (!sent.ok) return { ok: false, problem: sent.problem ?? fillWords(w.notUploaded, { name: chosen.name }) };
    // The video is stored by now: a still that cannot be kept leaves it without a picture, not without the video.
    const poster = still && upload ? await uploadPicture(upload, still).catch(() => null) : null;
    return {
      ok: true,
      video: { video: { url: sent.url }, poster: poster?.ok ? poster.image : null },
      saving: { before: chosen.size, after: file.size },
    };
  } catch {
    return { ok: false, problem: fillWords(w.notUploaded, { name: chosen.name }) };
  }
}

/**
 * A video's bytes to Storage: the server starts the upload (which keeps the video in the media library, D88), the browser
 * sends the file straight to the bucket, twice if the first try does not arrive (D536, `putWithRetry()`), and a video that
 * never arrived is taken out of the library again. `problem` is the server's own words when it refused to start, and null
 * when the file did not arrive, which each caller says in its own words. An animation's video (D538) goes up this way too.
 */
export async function sendVideo(
  startVideo: StartVideo,
  file: File,
  details: { name: string; compressed: boolean },
): Promise<{ ok: true; url: string } | { ok: false; problem: string | null }> {
  const started = await startVideo({ name: details.name, type: file.type, size: file.size, compressed: details.compressed });
  if (!started.ok) return { ok: false, problem: started.problem };
  const storage = createClient().storage.from(started.bucket);
  const stored = await putWithRetry(
    () => storage.uploadToSignedUrl(started.path, started.token, file, { contentType: file.type }),
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  );
  if (!stored.ok) {
    void startVideo({ type: file.type, size: file.size, abandoned: started.path }).catch(() => undefined);
    return { ok: false, problem: null };
  }
  return { ok: true, url: started.url };
}

/** The chosen file as bytes this tab holds, so sending it no longer depends on the phone's own file; null when it cannot be read. */
async function heldInMemory(file: File): Promise<File | null> {
  try {
    return new File([await file.arrayBuffer()], file.name, { type: file.type, lastModified: file.lastModified });
  } catch {
    return null;
  }
}

export function VideoUploadButton({
  startVideo,
  upload,
  label,
  keepSound = false,
  onUploaded,
}: {
  startVideo: StartVideo | null;
  upload: Upload | null;
  label: string;
  /** A row's background plays without sound, so its sound is left out; a video people play keeps it. */
  keepSound?: boolean;
  onUploaded: (video: UploadedVideo) => void;
}) {
  const ui = useAdminText("common").ui;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file || !startVideo) return;
    if (!VIDEO_TYPES.includes(file.type)) return setProblem(ui.videoType);
    setBusy(ui.compressing);
    setProblem(null);
    setSaved(null);
    const outcome = await uploadVideoFile(startVideo, upload, file, {
      keepSound,
      onProgress: (progress) => setBusy(progress < 1 ? fillWords(ui.compressingPercent, { percent: Math.round(progress * 100) }) : ui.uploading),
      words: ui,
    });
    if (outcome.ok) {
      onUploaded(outcome.video);
      setSaved(savingWords(outcome.saving.before, outcome.saving.after, ui.saved));
    } else setProblem(outcome.problem);
    setBusy(null);
  };

  if (!startVideo) return <p className="text-sm text-muted">{ui.uploadsOff}</p>;
  return (
    <div className="flex flex-col gap-2">
      <label className="w-fit cursor-pointer rounded-md border border-line px-3 py-2 text-sm focus-within:outline-2">
        {busy ?? label}
        <input
          type="file"
          accept="video/mp4,video/webm"
          className="sr-only"
          disabled={busy !== null}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      {/* The hint is a row background's: without sound, on a loop. A video people play says its own beside the button. */}
      {!keepSound && <p className="text-xs text-muted">{ui.videoHint}</p>}
      {saved && (
        <p role="status" className="text-xs text-muted">
          {saved}.
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
