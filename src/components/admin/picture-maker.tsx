"use client";

import { Sparkles } from "lucide-react";
import { createContext, useContext, useId, useState, type ReactNode } from "react";

import { BRIEF_MAX, BRIEF_MIN, PICTURE_SHAPES, shapeOf, type PictureShape } from "@/lib/picture-direction";

import { useAdminText } from "./admin-text";
import { Modal } from "./modal";
import { Button } from "./ui";

/** Where the site's pictures are made (D283): its builder's route, which checks who asks and keeps the picture in the media library. */
export type PictureMaker = { endpoint: string };

export type MadePicture = { url: string; width: number; height: number; alt: string };

/**
 * Lets any picture field in the page builder make its picture by prompt (D283), as `MediaPickerProvider` lets it choose from the library:
 * every `ImageUploadButton` below it offers *Make with AI*. Without a provider (no picture model, an editor that gives none) nothing shows.
 */
const MakerContext = createContext<PictureMaker | null>(null);

export function PictureMakerProvider({ maker, children }: { maker: PictureMaker | null | undefined; children?: ReactNode }) {
  return <MakerContext value={maker ?? null}>{children}</MakerContext>;
}

/** What each picture made in this tab was asked for, so making it again starts from the same words. Kept in memory only. */
const asked = new Map<string, { brief: string; follow: boolean }>();

/** A picture a field holds now: making it again starts from its description and keeps its shape. */
export type CurrentPicture = { url: string; width: number; height: number; alt?: string };

/** *Make with AI* (or *Make again with AI* for a field that has a picture); draws nothing where the site cannot make pictures. */
export function MakePictureButton({ current, onMade }: { current?: CurrentPicture | null; onMade: (picture: MadePicture) => void }) {
  const w = useAdminText("website").pictureMaker;
  const maker = useContext(MakerContext);
  const [open, setOpen] = useState(false);
  if (!maker) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-fit items-center gap-1.5 rounded-pill border border-edge px-3 py-2 text-sm focus-visible:outline-2"
      >
        <Sparkles aria-hidden className="size-4" />
        {current ? w.makeAgain : w.make}
      </button>
      {open && (
        <MakeDialog
          maker={maker}
          current={current ?? null}
          onClose={() => setOpen(false)}
          onUse={(picture) => {
            onMade(picture);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

const pill = (on: boolean) =>
  `cursor-pointer rounded-pill border px-3 py-1.5 text-sm focus-within:outline-2 ${on ? "border-ink bg-inverse text-inverse-ink" : "border-edge bg-card text-ink"}`;

/**
 * The description, already there when the picture is made again (what it was asked for here, else its alt text), its shape (the one it has)
 * and the site's look (on). Making shows the picture first; *Use this picture* puts it in the field, *Make another* tries the words again.
 */
function MakeDialog({
  maker,
  current,
  onClose,
  onUse,
}: {
  maker: PictureMaker;
  current: CurrentPicture | null;
  onClose: () => void;
  onUse: (picture: MadePicture) => void;
}) {
  const w = useAdminText("website").pictureMaker;
  const id = useId();
  const before = current ? asked.get(current.url) : undefined;
  const [brief, setBrief] = useState(before?.brief ?? current?.alt ?? "");
  const [shape, setShape] = useState<PictureShape>(current ? shapeOf(current.width, current.height) : "landscape");
  const [follow, setFollow] = useState(before?.follow ?? true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<MadePicture | null>(null);

  async function make() {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(maker.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, shape, follow }),
      });
      const result = (await response.json().catch(() => null)) as { ok: true; picture: MadePicture } | { ok: false; problem: string } | null;
      if (result?.ok) {
        asked.set(result.picture.url, { brief, follow });
        setMade(result.picture);
      } else setProblem(result?.problem ?? w.notMade);
    } catch {
      setProblem(w.notReached);
    } finally {
      setBusy(false);
    }
  }

  const enough = brief.trim().length >= BRIEF_MIN;
  return (
    <Modal open onClose={onClose} title={current ? w.titleAgain : w.title}>
      <form
        aria-busy={busy}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (enough && !busy) void make();
        }}
      >
        {made && (
          <figure className="flex flex-col gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- the picture just made, before it is used */}
            <img src={made.url} alt={made.alt} className="max-h-72 w-full rounded-panel border border-line bg-sunken object-contain" />
            <figcaption className="text-xs text-muted">{w.kept}</figcaption>
          </figure>
        )}
        <label htmlFor={`${id}-brief`} className="flex flex-col gap-1 text-sm">
          <span className="text-body-strong text-ink">{w.show}</span>
          <textarea
            id={`${id}-brief`}
            rows={4}
            maxLength={BRIEF_MAX}
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit();
            }}
            placeholder={w.placeholder}
            className="rounded-md border border-line bg-card px-3 py-2 text-sm"
          />
          <span className="text-xs text-muted">{w.showHint}</span>
        </label>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 text-body-strong text-ink">{w.shape}</legend>
          <div className="flex flex-wrap gap-2">
            {PICTURE_SHAPES.map((one) => (
              <label key={one} className={pill(shape === one)}>
                <input type="radio" name={`${id}-shape`} value={one} checked={shape === one} onChange={() => setShape(one)} className="sr-only" />
                {w.shapes[one]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} className="mt-0.5 size-4" />
          <span>
            {w.siteLook}
            <span className="block text-xs text-muted">{w.siteLookHint}</span>
          </span>
        </label>
        {busy && (
          <p role="status" className="text-sm text-muted">
            {w.making}
          </p>
        )}
        {problem && (
          <p role="alert" className="text-sm text-danger-text">
            {problem}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {made ? (
            <>
              <Button kind="secondary" type="submit" disabled={!enough || busy}>
                {w.another}
              </Button>
              <Button kind="main" disabled={busy} onClick={() => onUse(made)}>
                {w.use}
              </Button>
            </>
          ) : (
            <>
              <Button kind="quiet" onClick={onClose}>
                {w.cancel}
              </Button>
              <Button kind="main" type="submit" disabled={!enough || busy}>
                {w.makePicture}
              </Button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
