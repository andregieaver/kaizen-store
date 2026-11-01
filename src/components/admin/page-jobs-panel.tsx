"use client";

import { useState, useTransition } from "react";

import type { FormState } from "@/components/admin/action-form";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { RunningPageJob } from "@/server/page-jobs";

import { useAdminText } from "./admin-text";
import { RefreshWhile } from "./refresh-while";
import { ButtonLink, buttonClass, Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";

/**
 * The AI's page work still going, on a site's Pages and Articles lists (PSI UX-01): each build waiting or being built, and each page whose
 * pictures are still being made with a bar of how many are done, with a Stop for each (`stopPageJob()`). The list reads itself again every
 * ten seconds while anything is going, so a build that finishes leaves it and its page appears in the list below; nothing shows when the AI
 * is making nothing.
 */
export function PageJobsPanel({
  jobs,
  pagesBase,
  articlesBase,
  stop,
}: {
  jobs: RunningPageJob[];
  /** Where the site's pages and articles are edited, `/admin/{store}/pages` and `/articles`. */
  pagesBase: string;
  articlesBase: string;
  /** Stops a build or a page's pictures; absent for a person who may not change the site. */
  stop?: (kind: RunningPageJob["kind"], id: string) => Promise<FormState>;
}) {
  const w = useAdminText("website").pageJobs;
  const [answer, setAnswer] = useState<FormState | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const status = answer && answer.status !== "idle" ? answer : null;
  if (jobs.length === 0 && !status) return null;

  const stopOne = (kind: RunningPageJob["kind"], id: string) => {
    if (!stop) return;
    setStopping(id);
    startTransition(async () => {
      try {
        setAnswer(await stop(kind, id));
      } finally {
        setStopping(null);
      }
    });
  };

  return (
    <Card title={w.title} description={w.intro} count={jobs.length}>
      {jobs.length > 0 && <RefreshWhile seconds={10} />}
      <p role="status" className={status ? `mb-3 text-sm ${status.status === "error" ? "text-danger-text" : "text-ink"}` : "sr-only"}>
        {status?.messages.join(" ") ?? ""}
      </p>
      {jobs.length > 0 && (
        <List label={w.title}>
          {jobs.map((job) => {
            const id = job.kind === "build" ? job.id : job.pageId;
            const title = job.title.trim() || w.untitled;
            const total = job.kind === "pictures" ? job.made + job.waiting + job.notMade : 0;
            return (
              <ListRow key={`${job.kind}-${id}`}>
                {job.kind === "build" ? (
                  <RowLead
                    title={title}
                    sub={
                      <span className="inline-flex items-center gap-2">
                        {job.running && <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />}
                        <Chip signal={job.running ? "insight" : "neutral"} dot>
                          {job.running ? w.building : w.waiting}
                        </Chip>
                      </span>
                    }
                  />
                ) : (
                  <RowLead
                    title={title}
                    sub={
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <progress className="h-2 w-32" value={job.made + job.notMade} max={total} aria-label={fillWords(w.pictures, { made: job.made, total })} />
                        <span>
                          {fillWords(w.pictures, { made: job.made, total })}
                          {job.notMade > 0 && ` · ${countWords(job.notMade, w.notMade)}`}
                        </span>
                      </span>
                    }
                  />
                )}
                <RowActions>
                  {job.kind === "pictures" && (
                    <ButtonLink kind="quiet" size="dense" href={`${job.type === "article" ? articlesBase : pagesBase}/${job.pageId}`}>
                      {w.open}
                    </ButtonLink>
                  )}
                  {stop && (
                    <button type="button" className={buttonClass("secondary", "dense")} disabled={stopping !== null} onClick={() => stopOne(job.kind, id)}>
                      {stopping === id ? w.stopping : job.kind === "build" ? w.stop : w.stopPictures}
                    </button>
                  )}
                </RowActions>
              </ListRow>
            );
          })}
        </List>
      )}
    </Card>
  );
}
