"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { hint, primary, secondary } from "@/components/admin/data/ui";
import { countWords } from "@/lib/admin-fill";
import type { CopyFeed, FeedProblem, FeedStage } from "@/lib/shopify-copy";

import { useAdminText } from "../admin-text";

/** The parts with no Shopify file to use instead: their own screen here is the way. */
const SET_HERE: readonly CopyFeed[] = ["countries", "shipping", "discounts", "look", "pages", "articles", "menus"];

export type CopyRow = {
  feed: CopyFeed;
  stage: FeedStage;
  count: number | null;
  problem: FeedProblem | null;
  /** The import job's own page, once there is one. */
  href: string | null;
  /** The file import to use instead when this part could not be copied. */
  fileHref: string;
  /** From the dry run: how many would come over, and how many need a look. */
  ready: number | null;
  needLook: number | null;
};

export type CopyActions = {
  start: () => Promise<{ ok: boolean }>;
  advance: () => Promise<{ moving: boolean }>;
  bring: () => Promise<{ ok: boolean }>;
};

/**
 * *Copy my shop* (D445 step 4): one button, then a line for each part (products, customers, past orders, redirects) that says where it is;
 * while anything moves the page asks the server to go on every few seconds. When every part is checked, *Bring it over* saves them in order.
 * Each part's import has its own page (*See what will happen*), where Lisa sees every row; Homer needs none of it.
 */
export function ShopCopy({ started, moving, ready, done, failed, rows, actions, privateHref }: { started: boolean; moving: boolean; ready: boolean; done: boolean; failed: number; rows: CopyRow[]; actions: CopyActions; privateHref: string }) {
  const w = useAdminText("moving").copy;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!moving) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const result = await actions.advance().catch(() => ({ moving: true }));
      router.refresh();
      if (!stop && result.moving) timer = setTimeout(tick, 3000);
    };
    let timer = setTimeout(tick, 1500);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [moving, actions, router]);

  const press = (action: () => Promise<{ ok: boolean }>) =>
    start(async () => {
      await action();
      setAsking(false);
      router.refresh();
    });

  if (!started)
    return (
      <section aria-labelledby="shop-copy" className="flex flex-col gap-2">
        <h3 id="shop-copy" className="text-base font-medium">
          {w.title}
        </h3>
        <p className="text-sm">{w.text}</p>
        <div>
          <button type="button" disabled={pending} className={primary} onClick={() => press(actions.start)}>
            {pending ? w.starting : w.start}
          </button>
        </div>
      </section>
    );

  return (
    <section aria-labelledby="shop-copy" className="flex flex-col gap-3" aria-busy={moving}>
      <h3 id="shop-copy" className="text-base font-medium">
        {w.title}
      </h3>
      <ul className="flex flex-col gap-2 text-sm" aria-live="polite">
        {rows.map((row) => (
          <li key={row.feed} className="flex flex-col gap-0.5">
            <span>
              <span className="font-medium">{w.feeds[row.feed]}</span>: {w.stages[row.stage]}
              {row.count !== null && row.stage !== "empty" && row.stage !== "failed" ? ` · ${countWords(row.count, w.found)}` : ""}
              {row.needLook !== null && row.needLook > 0 ? ` · ${countWords(row.needLook, w.needLook)}` : ""}
            </span>
            {row.href && (row.stage === "checked" || row.stage === "applying" || row.stage === "done" || row.problem === "import_failed" || row.problem === "import_refused" || row.problem === "needs_fixing") && (
              <Link href={row.href} className="w-fit text-xs underline underline-offset-2">
                {row.stage === "done" ? w.seeDone : w.see}
              </Link>
            )}
            {!row.href && !row.problem && row.stage === "done" && row.needLook !== null && row.needLook > 0 && (
              <Link href={row.fileHref} className="w-fit text-xs underline underline-offset-2">
                {w.lookHere}
              </Link>
            )}
            {row.problem && (
              <span className={hint}>
                {w.problems[row.problem]}{" "}
                <Link href={row.fileHref} className="underline underline-offset-2">
                  {SET_HERE.includes(row.feed) ? w.setHere : w.files}
                </Link>
              </span>
            )}
          </li>
        ))}
      </ul>
      {ready && (
        <div className="flex flex-col gap-2">
          <p className={hint}>{w.bringText}</p>
          <p className={hint}>
            {w.liveNote}{" "}
            <Link href={privateHref} className="underline underline-offset-2">
              {w.liveLink}
            </Link>
          </p>
          <div>
            <button type="button" disabled={pending} className={primary} onClick={() => press(actions.bring)}>
              {pending ? w.bringing : w.bring}
            </button>
          </div>
        </div>
      )}
      {done && <p className="text-sm font-medium">{failed > 0 ? countWords(failed, w.doneSome) : w.done}</p>}
      {!moving &&
        (asking ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label={w.again}>
            <span>{w.againAsk}</span>
            <button type="button" disabled={pending} className={secondary} onClick={() => press(actions.start)}>
              {w.again}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="underline underline-offset-2">
              {w.cancel}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setAsking(true)} className="w-fit text-xs underline underline-offset-2">
            {w.again}
          </button>
        ))}
    </section>
  );
}
