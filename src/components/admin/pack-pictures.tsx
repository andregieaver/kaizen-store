"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "./ui";

/** What one press of the picture action gives: how many pictures the pack still lacks, or why none was made. */
export type PackPictureResult = { ok: true; remaining: number } | { ok: false; problems: string[] };

/**
 * *Make the pictures* for one content pack (`docs/theme-showcase-phase-1.md` step 2): asks the server for one picture at a time (each
 * takes a while, and a request has a time limit) until none is missing, a picture fails, or the person stops. What is made stays made.
 */
export function PackPictures({ title, made, total, action }: { title: string; made: number; total: number; action: () => Promise<PackPictureResult> }) {
  const router = useRouter();
  const [count, setCount] = useState(made);
  const [working, setWorking] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const stopAsked = useRef(false);

  async function run() {
    setWorking(true);
    setProblem(null);
    stopAsked.current = false;
    let remaining = total - count;
    try {
      while (remaining > 0 && !stopAsked.current) {
        const result = await action();
        if (!result.ok) {
          setProblem(result.problems.join(" "));
          break;
        }
        remaining = result.remaining;
        setCount(total - remaining);
      }
    } catch {
      setProblem("The picture could not be made. Try again.");
    } finally {
      setWorking(false);
      setStopping(false);
      router.refresh();
    }
  }

  const left = total - count;
  return (
    <div aria-busy={working} className="flex flex-wrap items-center gap-2 text-sm">
      {left > 0 && !working && (
        <Button kind="secondary" onClick={run}>
          {count === 0 ? "Make the pictures" : "Make the rest"}
          <span className="sr-only"> of {title}</span>
        </Button>
      )}
      {working && (
        <Button
          kind="quiet"
          disabled={stopping}
          onClick={() => {
            stopAsked.current = true;
            setStopping(true);
          }}
        >
          {stopping ? "Stopping after this picture…" : "Stop"}
        </Button>
      )}
      <span role="status" className="text-muted">
        {working ? `Making picture ${Math.min(count + 1, total)} of ${total}…` : left === 0 ? "Every picture is made." : `${count} of ${total} pictures made.`}
      </span>
      {problem && (
        <span role="alert" className="text-danger-text">
          {problem}
        </span>
      )}
    </div>
  );
}
