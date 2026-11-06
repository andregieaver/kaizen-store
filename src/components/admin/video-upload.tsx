"use client";

import { useState } from "react";

import { savingWords } from "@/lib/image-quality";
import { createClient } from "@/lib/supabase/client";
import { canCompressVideo, compressVideo, VIDEO_CHOOSE_MAX_BYTES, VIDEO_MAX_BYTES } from "@/lib/video-compress";

import { uploadPicture, type Saving, type Upload, type Uploaded } from "./image-upload";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import type { CommonMessages } from "@/lib/admin-messages/common.en";

/** Starts a video's upload: a signed upload to the public bucket and the address it will have. */
export type StartVideo = (file: { name?: string; type: string; size: number; compressed?: boolean }) => Promise<
  { ok: true; path: string; token: string; bucket: string; url: string } | { ok: false; problem: string }
>;

export type UploadedVideo = { video: { url: string }; poster: Uploaded | null };

const VIDEO_TYPES = ["video/mp4", "video/webm"];

/**
 * A still from early in the video, as a picture: shown until the video
 * plays, and instead of it for people who prefer less motion. Null when
 * this browser cannot play the video to take one.
 */
export function takeStill(file: File): Promise<File | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (still: File | null) => {
      URL.revokeObjectURL(url);
      resolve(still);
    };
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
    const file = compressed?.file ?? chosen;
    if (file.size > VIDEO_MAX_BYTES) return { ok: false, problem: w.videoTooLargeCompressed };
    const started = await startVideo({ name: chosen.name, type: file.type, size: file.size, compressed: compressed !== null });
    if (!started.ok) return { ok: false, problem: started.problem };
    const [stored, still] = await Promise.all([
      createClient().storage.from(started.bucket).uploadToSignedUrl(started.path, started.token, file, { contentType: file.type }),
      upload ? takeStill(file) : Promise.resolve(null),
    ]);
    if (stored.error) return { ok: false, problem: fillWords(w.notUploaded, { name: chosen.name }) };
    const poster = still && upload ? await uploadPicture(upload, still) : null;
    return {
      ok: true,
      video: { video: { url: started.url }, poster: poster?.ok ? poster.image : null },
      saving: { before: chosen.size, after: file.size },
    };
  } catch {
    return { ok: false, problem: fillWords(w.notUploaded, { name: chosen.name }) };
  }
}

export function VideoUploadButton({
  startVideo,
  upload,
  label,
  onUploaded,
}: {
  startVideo: StartVideo | null;
  upload: Upload | null;
  label: string;
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
    // A row's background plays without sound, so its sound is left out.
    const outcome = await uploadVideoFile(startVideo, upload, file, {
      keepSound: false,
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
      <p className="text-xs text-muted">{ui.videoHint}</p>
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
