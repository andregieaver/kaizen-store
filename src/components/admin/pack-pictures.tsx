"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { SLOT_BRIEF_MAX } from "@/lib/picture-direction";
import type { PackSlotView } from "@/server/content-packs";

import { countWords, fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";
import { Modal } from "./modal";
import { Button } from "./ui";

/** What asking for a pack's pictures, or stopping them, answers. */
export type PackPictureResult = { ok: true } | { ok: false; problems: string[] };

/** How often the page looks again while the job makes a pack's pictures. */
const LOOK_AGAIN_MS = 15_000;

/**
 * *Make the pictures* for one content pack (D271): one press asks Kaizena Flow's job to make them, one at a time, a minute or two each, on
 * the server; the person may leave the page (`PackPicturesWatch` keeps the page current meanwhile), and *Stop* ends it after the picture
 * being made. What is made stays made; after three failed tries in a row the job stops and the reason shows here.
 */
export function PackPictures({
  title,
  made,
  total,
  asked,
  problem,
  ask,
  stop,
}: {
  title: string;
  made: number;
  total: number;
  asked: boolean;
  problem: string | null;
  ask: () => Promise<PackPictureResult>;
  stop: () => Promise<PackPictureResult>;
}) {
  const router = useRouter();
  const w = useAdminText("platformSite").pictures;
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const left = total - made;

  async function press(action: () => Promise<PackPictureResult>) {
    setBusy(true);
    setSaid(null);
    try {
      const result = await action();
      if (!result.ok) setSaid(result.problems.join(" "));
    } catch {
      setSaid(w.noReach);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const shown = said ?? (!asked && left > 0 ? problem : null);
  return (
    <div aria-busy={busy} className="flex flex-wrap items-center gap-2 text-sm">
      {left > 0 && !asked && (
        <Button kind="secondary" disabled={busy} onClick={() => press(ask)}>
          {made === 0 ? w.make : w.makeRest}
          <span className="sr-only"> {fillWords(w.of, { title })}</span>
        </Button>
      )}
      {left > 0 && asked && (
        <Button kind="quiet" disabled={busy} onClick={() => press(stop)}>
          {w.stop}
          <span className="sr-only"> {fillWords(w.stopMaking, { title })}</span>
        </Button>
      )}
      <span role="status" className="text-muted">
        {left === 0 ? w.allMade : fillWords(asked ? w.making : w.made, { made, total })}
      </span>
      {shown && (
        <span role="alert" className="text-danger-text">
          {said ? shown : fillWords(w.stopped, { problem: shown })}
        </span>
      )}
    </div>
  );
}

/** *Make every picture*: asks for the pictures of every pack that lacks some, in one press. */
export function AllPackPictures({ ask }: { ask: () => Promise<PackPictureResult> }) {
  const router = useRouter();
  const w = useAdminText("platformSite").pictures;
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div aria-busy={busy} className="flex flex-wrap items-center gap-2 text-sm">
      <Button
        kind="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setSaid(null);
          try {
            const result = await ask();
            if (!result.ok) setSaid(result.problems.join(" "));
          } catch {
            setSaid(w.noReach);
          } finally {
            setBusy(false);
            router.refresh();
          }
        }}
      >
        {w.makeAll}
      </Button>
      {said && (
        <span role="alert" className="text-danger-text">
          {said}
        </span>
      )}
    </div>
  );
}

/** While the job makes pictures, the page looks again now and then, so the counts follow without a reload. Draws nothing. */
export function PackPicturesWatch({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), LOOK_AGAIN_MS);
    return () => window.clearInterval(timer);
  }, [active, router]);
  return null;
}


/**
 * A pack's pictures one by one (D283), on a theme's Content tab: each with *Make again*, which asks the job to make that one again from its
 * brief (shown, and changed if the person likes), and *Put back the one before* once a picture has been made again. The picture shown stays
 * until the new one is made; the page keeps itself current meanwhile.
 */
export function PackSlotPictures({
  title,
  slots,
  problem,
  remake,
  putBack,
  stop,
}: {
  title: string;
  slots: PackSlotView[];
  problem: string | null;
  remake: (slot: string, brief: string) => Promise<PackPictureResult>;
  putBack: (slot: string) => Promise<PackPictureResult>;
  stop: () => Promise<PackPictureResult>;
}) {
  const router = useRouter();
  const w = useAdminText("platformSite").pictures;
  const stateWords = (state: PackSlotView["state"]): string | null => (state === "made" ? null : w.slotStates[state]);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [open, setOpen] = useState<PackSlotView | null>(null);
  const making = slots.filter((slot) => slot.again).length;

  async function press(key: string, action: () => Promise<PackPictureResult>): Promise<boolean> {
    setBusy(key);
    setSaid(null);
    try {
      const result = await action();
      if (!result.ok) setSaid(result.problems.join(" "));
      return result.ok;
    } catch {
      setSaid(w.noReach);
      return false;
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  return (
    <div aria-busy={busy !== null} className="flex flex-col gap-4">
      <PackPicturesWatch active={making > 0} />
      {(making > 0 || said || problem) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {making > 0 && (
            <>
              <span role="status" className="text-muted">
                {countWords(making, w.makingAgain)}
              </span>
              <Button kind="quiet" disabled={busy !== null} onClick={() => void press("stop", stop)}>
                {w.stop}
                <span className="sr-only"> {fillWords(w.stopAgain, { title })}</span>
              </Button>
            </>
          )}
          {(said ?? (making === 0 ? problem : null)) && (
            <span role="alert" className="text-danger-text">
              {said ?? fillWords(w.stopped, { problem: problem ?? "" })}
            </span>
          )}
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {slots.map((slot) => (
          <li key={slot.slot} className="flex gap-3 rounded-panel border border-line p-3">
            {slot.picture ? (
              // eslint-disable-next-line @next/next/no-img-element -- the pack store's own picture, small
              <img src={slot.picture.thumbnailUrl ?? slot.picture.url} alt="" className="size-20 shrink-0 rounded-panel bg-sunken object-cover" />
            ) : (
              <div aria-hidden className="size-20 shrink-0 rounded-panel bg-sunken" />
            )}
            <div className="flex min-w-0 flex-col items-start gap-1.5 text-sm">
              <p className="text-body-strong text-ink">{slot.label}</p>
              {slot.again ? (
                <p role="status" className="text-muted">
                  {w.beingMade}
                </p>
              ) : (
                stateWords(slot.state) && <p className="text-muted">{stateWords(slot.state)}</p>
              )}
              {slot.state === "made" && !slot.again && (
                <div className="flex flex-wrap gap-1">
                  <Button kind="secondary" size="dense" disabled={busy !== null} aria-label={fillWords(w.makeAgainOf, { label: slot.label })} onClick={() => setOpen(slot)}>
                    {w.makeAgain}
                  </Button>
                  {slot.previous && (
                    <Button
                      kind="quiet"
                      size="dense"
                      disabled={busy !== null}
                      aria-label={fillWords(w.putBackOf, { label: slot.label })}
                      onClick={() => void press(slot.slot, () => putBack(slot.slot))}
                    >
                      {w.putBack}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {open && (
        <RemakeDialog
          slot={open}
          busy={busy !== null}
          onClose={() => setOpen(null)}
          onRemake={async (brief) => {
            if (await press(open.slot, () => remake(open.slot, brief))) setOpen(null);
          }}
        />
      )}
    </div>
  );
}

/** The slot's brief, as it was last made from, for the person to keep or change, and *Make it again*. */
function RemakeDialog({
  slot,
  busy,
  onClose,
  onRemake,
}: {
  slot: PackSlotView;
  busy: boolean;
  onClose: () => void;
  onRemake: (brief: string) => Promise<void>;
}) {
  const id = useId();
  const w = useAdminText("platformSite").pictures;
  const [brief, setBrief] = useState(slot.brief);
  return (
    <Modal open onClose={onClose} title={fillWords(w.makeAgainOf, { label: slot.label })}>
      <form
        aria-busy={busy}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onRemake(brief);
        }}
      >
        {slot.picture && (
          // eslint-disable-next-line @next/next/no-img-element -- the picture now, before it is made again
          <img src={slot.picture.url} alt="" className="max-h-56 w-full rounded-panel border border-line bg-sunken object-contain" />
        )}
        <label htmlFor={`${id}-brief`} className="flex flex-col gap-1 text-sm">
          <span className="text-body-strong text-ink">{w.shows}</span>
          <textarea
            id={`${id}-brief`}
            rows={6}
            maxLength={SLOT_BRIEF_MAX}
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            className="rounded-md border border-line bg-card px-3 py-2 text-sm"
          />
          <span className="text-xs text-muted">{w.showsHint}</span>
        </label>
        <p className="text-xs text-muted">{w.jobNote}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button kind="quiet" onClick={onClose}>
            {w.cancel}
          </Button>
          <Button kind="main" type="submit" disabled={busy || brief.trim().length < 3}>
            {w.makeIt}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
