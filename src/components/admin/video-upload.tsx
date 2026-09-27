"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

import { uploadPicture, type Upload, type Uploaded } from "./image-upload";

/** Starts a video's upload: a signed upload to the public bucket and the address it will have. */
export type StartVideo = (file: { type: string; size: number }) => Promise<
  { ok: true; path: string; token: string; bucket: string; url: string } | { ok: false; problem: string }
>;

export type UploadedVideo = { video: { url: string }; poster: Uploaded | null };

const VIDEO_TYPES = ["video/mp4", "video/webm"];
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;

/**
 * A still from early in the video, as a picture: shown until the video
 * plays, and instead of it for people who prefer less motion. Null when
 * this browser cannot play the video to take one.
 */
function takeStill(file: File): Promise<File | null> {
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
 * Chooses a row's background video and uploads it straight from the browser
 * to the public bucket (videos are too large for a server request), with a
 * still from it uploaded as a picture.
 */
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
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file || !startVideo) return;
    if (!VIDEO_TYPES.includes(file.type)) return setProblem("Use an MP4 or WebM video.");
    if (file.size > VIDEO_MAX_BYTES) return setProblem("That video is too large. Use one under 50 MB.");
    setBusy(true);
    setProblem(null);
    try {
      const started = await startVideo({ type: file.type, size: file.size });
      if (!started.ok) return setProblem(started.problem);
      const [stored, still] = await Promise.all([
        createClient().storage.from(started.bucket).uploadToSignedUrl(started.path, started.token, file, { contentType: file.type }),
        takeStill(file),
      ]);
      if (stored.error) return setProblem(`${file.name} could not be uploaded. Try again.`);
      const poster = still && upload ? await uploadPicture(upload, still) : null;
      onUploaded({ video: { url: started.url }, poster: poster?.ok ? poster.image : null });
    } catch {
      setProblem(`${file.name} could not be uploaded. Try again.`);
    } finally {
      setBusy(false);
    }
  };

  if (!startVideo) return <p className="text-sm text-muted">Uploads are not set up on this server.</p>;
  return (
    <div className="flex flex-col gap-2">
      <label className="w-fit cursor-pointer rounded-md border border-border px-3 py-2 text-sm focus-within:outline-2">
        {busy ? "Uploading …" : label}
        <input
          type="file"
          accept="video/mp4,video/webm"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      <p className="text-xs text-muted">MP4 or WebM, up to 50 MB. It plays without sound, on a loop.</p>
      {problem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  );
}
