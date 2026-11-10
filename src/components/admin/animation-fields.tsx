"use client";

import { useId, useState } from "react";

import { fillWords } from "@/lib/admin-fill";
import { ANIMATION_SOURCE_TYPES, type AnimationFile } from "@/lib/animation";
import { makeAnimation } from "@/lib/animation-make";
import { ANIMATION_WORDS, type AnimationWords } from "@/lib/animation-words";
import { ALT_MAX, animationPicture, isLinkAddress, type AnimationBlock } from "@/lib/page-content";

import { useAdminText, useHandedText } from "./admin-text";
import { Check, smallButton, type BlockEditorProps } from "./block-fields";
import { ImageSizeFields } from "./image-size-fields";
import { uploadPicture } from "./image-upload";
import { sendVideo } from "./video-upload";

/**
 * An animation's fields in the builder (D538, `src/lib/animation.ts`). For Homer: one button. He chooses the WebM his
 * animation program gave him, his browser prepares it (`makeAnimation()`) and uploads the two files it makes, and the
 * animation is on the page, playing once and resting on its last frame. Then what a picture has: its description and
 * where it leads. For Lisa, on the Style tab: its width and position by screen size, and whether it goes round.
 */

/** The words in the account's language: the page hands them down (`animation`, D312), else `animation-words.ts`'s English. */
const useWords = (): AnimationWords => useHandedText("animation") ?? ANIMATION_WORDS;

/**
 * Choosing an animation: its last frame as a preview, one button that prepares and uploads the chosen WebM, and what went
 * wrong in the owner's words. The Animation component's own, and the logo part's (`AnimatedLogoFields`).
 */
export function AnimationUpload({
  animation,
  context,
  onChange,
}: {
  animation: AnimationFile | null;
  context: Pick<BlockEditorProps<AnimationBlock>["context"], "upload" | "startVideo">;
  onChange: (animation: AnimationFile | null) => void;
}) {
  const w = useWords();
  const iw = useAdminText("builder").image;
  const ui = useAdminText("common").ui;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    const { upload, startVideo } = context;
    if (!file || !upload || !startVideo) return;
    setProblem(null);
    const failed = (why: string) => {
      setProblem(why);
      setBusy(null);
    };
    const preparing = (share: number) => setBusy(fillWords(w.preparing, { percent: Math.round(share * 100) }));
    preparing(0);
    const outcome = await makeAnimation(file, { onProgress: preparing });
    if (!outcome.ok) return failed(w.refusals[outcome.why]);
    const { made } = outcome;
    setBusy(ui.uploading);
    const notUploaded = fillWords(ui.notUploaded, { name: file.name });
    try {
      // The picture first: without it there is nothing to rest on, and the video would be a file nothing shows.
      const picture = await uploadPicture(upload, made.still);
      if (!picture.ok) return failed(picture.problem);
      const name = fillWords(w.fileName, { name: file.name.replace(/\.[a-z0-9]+$/i, "") });
      // Marked as compressed: the library must never make it smaller again, which would move the picture off its mask.
      const sent = await sendVideo(startVideo, made.video, { name: `${name}.mp4`, compressed: true });
      if (!sent.ok) return failed(sent.problem ?? notUploaded);
      onChange({ video: { url: sent.url }, still: picture.image, width: made.width, height: made.height });
      setBusy(null);
    } catch {
      failed(notUploaded);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {animation ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin preview of the animation's last frame
        <img src={animation.still.url} alt="" className="max-h-72 w-full rounded-md border border-line bg-sunken object-contain" />
      ) : (
        <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-line bg-sunken text-sm text-muted">{w.none}</div>
      )}
      {context.upload && context.startVideo ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="w-fit cursor-pointer rounded-md border border-line px-3 py-2 text-sm focus-within:outline-2">
              {busy ?? (animation ? w.another : w.upload)}
              <input
                type="file"
                accept={ANIMATION_SOURCE_TYPES.join(",")}
                className="sr-only"
                disabled={busy !== null}
                onChange={(event) => {
                  void choose(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            {animation && busy === null && (
              <button type="button" onClick={() => onChange(null)} className={smallButton}>
                {iw.remove}
              </button>
            )}
          </div>
          <p className="text-xs text-muted">{w.hint}</p>
          {problem && (
            <p role="alert" className="text-sm text-danger-text">
              {problem}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">{ui.uploadsOff}</p>
      )}
    </div>
  );
}

export function AnimationBlockFields({ block, onChange, context }: BlockEditorProps<AnimationBlock>) {
  const id = useId();
  const w = useWords();
  const iw = useAdminText("builder").image;
  const still = animationPicture(block);
  const href = block.href?.trim() ?? "";
  const badLink = href !== "" && !isLinkAddress(href);
  return (
    <div className="flex flex-col gap-4">
      <AnimationUpload animation={block.animation} context={context} onChange={(animation) => onChange({ animation })} />
      {still && <p className="text-xs text-muted">{fillWords(w.ownSize, { width: still.width, height: still.height })}</p>}
      {block.animation && (
        <>
          <label htmlFor={`${id}-alt`} className="flex flex-col gap-1 text-sm font-medium">
            {w.description}
            <textarea
              id={`${id}-alt`}
              rows={2}
              maxLength={ALT_MAX}
              value={block.alt}
              onChange={(event) => onChange({ alt: event.target.value })}
              className="rounded-md border border-line bg-card px-3 py-2 text-sm font-normal"
            />
            <span className="text-xs font-normal text-muted">{w.descriptionHint}</span>
          </label>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-href`} className="text-sm font-medium">
              {iw.link} <span className="font-normal text-muted">({iw.optional})</span>
            </label>
            <input
              id={`${id}-href`}
              value={block.href ?? ""}
              maxLength={2000}
              spellCheck={false}
              placeholder={iw.addressPlaceholder}
              aria-invalid={badLink}
              aria-describedby={`${id}-href-hint`}
              onChange={(event) => onChange({ href: event.target.value || undefined })}
              className="min-h-10 rounded-md border border-line bg-card px-3 text-sm aria-invalid:border-danger-text"
            />
            <span id={`${id}-href-hint`} className={`text-xs ${badLink ? "text-danger-text" : "text-muted"}`}>
              {badLink ? iw.badAddress : iw.linkHint}
            </span>
          </div>
          {href !== "" && <Check label={iw.newTab} hint={iw.newTabHint} checked={Boolean(block.newTab)} onChange={(newTab) => onChange({ newTab: newTab || undefined })} />}
        </>
      )}
    </div>
  );
}

/**
 * The logo part's animation (D538), in a header's or footer's logo settings: the same one button. The logo then plays once
 * a visit and rests as the logo; the site's logo stays what every other place shows.
 */
export function AnimatedLogoFields({
  animation,
  context,
  onChange,
}: {
  animation: AnimationFile | undefined;
  context: Pick<BlockEditorProps<AnimationBlock>["context"], "upload" | "startVideo">;
  onChange: (animation: AnimationFile | undefined) => void;
}) {
  const w = useWords();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{w.logo}</p>
      <AnimationUpload animation={animation ?? null} context={context} onChange={(made) => onChange(made ?? undefined)} />
      <p className="text-xs text-muted">{w.logoHint}</p>
    </div>
  );
}

/** An animation's width and position, as a picture's (D151), and whether it goes round. */
export function AnimationStyleFields({ block, onChange }: BlockEditorProps<AnimationBlock>) {
  const w = useWords();
  return (
    <>
      <ImageSizeFields block={block} onChange={(patch) => onChange(patch as Partial<AnimationBlock>)} />
      <Check label={w.loop} hint={w.loopHint} checked={Boolean(block.loop)} onChange={(loop) => onChange({ loop: loop || undefined })} />
    </>
  );
}
