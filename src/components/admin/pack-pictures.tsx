"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
      setSaid("That did not reach Kaizena Flow. Check your connection and try again.");
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
          {made === 0 ? "Make the pictures" : "Make the rest"}
          <span className="sr-only"> of {title}</span>
        </Button>
      )}
      {left > 0 && asked && (
        <Button kind="quiet" disabled={busy} onClick={() => press(stop)}>
          Stop<span className="sr-only"> making the pictures of {title}</span>
        </Button>
      )}
      <span role="status" className="text-muted">
        {left === 0
          ? "Every picture is made."
          : asked
            ? `Making the pictures: ${made} of ${total} made. You can leave this page.`
            : `${made} of ${total} pictures made.`}
      </span>
      {shown && (
        <span role="alert" className="text-danger-text">
          {said ? shown : `Stopped: ${shown}`}
        </span>
      )}
    </div>
  );
}

/** *Make every picture*: asks for the pictures of every pack that lacks some, in one press. */
export function AllPackPictures({ ask }: { ask: () => Promise<PackPictureResult> }) {
  const router = useRouter();
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
            setSaid("That did not reach Kaizena Flow. Check your connection and try again.");
          } finally {
            setBusy(false);
            router.refresh();
          }
        }}
      >
        Make every picture
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
