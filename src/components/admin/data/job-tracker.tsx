"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { isWorking } from "@/lib/data-admin";
import type { JobKind, JobPhase, JobStatus } from "@/lib/data-job";

import { JobProgressView, type JobView } from "./job-views";

type Tick = { id: string; kind: string; status: JobStatus; phase: JobPhase | null; rowsDone: number | null; rowsTotal: number | null; problem: string | null };

/**
 * Keeps a job going while its page is open (D165, `docs/wave-2-data.md` 5.2): asks the page's tick route for the next step, which runs the job once and
 * answers with its state, and draws the progress. When the job stops being worked on the page is refreshed, so the server draws what is next (the result,
 * the files). If the page is closed the five-minute job takes the job up, so nothing depends on this component; it only makes it quick.
 */
export function JobTracker({ tickUrl, initial }: { tickUrl: string; initial: JobView }) {
  const router = useRouter();
  const [job, setJob] = useState<JobView>(initial);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    let alive = true;
    let failures = 0;
    const run = async () => {
      while (alive) {
        try {
          const response = await fetch(tickUrl, { method: "POST", cache: "no-store" });
          if (!alive) return;
          if (response.status === 404) {
            setLost(true);
            return;
          }
          if (!response.ok) throw new Error(String(response.status));
          const state = (await response.json()) as Tick;
          failures = 0;
          setJob((before) => ({ ...before, status: state.status, phase: state.phase, rowsDone: state.rowsDone, rowsTotal: state.rowsTotal, problem: state.problem, kind: state.kind as JobKind }));
          if (!isWorking(state.status)) {
            router.refresh();
            return;
          }
          // Another request may hold the job: ask again soon, not at once.
          await new Promise((resolve) => setTimeout(resolve, 1200));
        } catch {
          failures += 1;
          if (failures >= 5) {
            setLost(true);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    };
    if (isWorking(initial.status)) void run();
    return () => {
      alive = false;
    };
  }, [tickUrl, initial.status, router]);

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <JobProgressView job={job} />
      {lost && <p className="text-sm text-muted">This page lost touch with the job. It keeps going on its own: reload the page to see where it is.</p>}
    </div>
  );
}
