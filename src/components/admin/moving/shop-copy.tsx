"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { hint, primary, secondary } from "@/components/admin/data/ui";
import { countWords } from "@/lib/admin-fill";
import type { CopyFeed, FeedProblem, FeedStage } from "@/lib/shopify-copy";

import { useAdminText } from "../admin-text";

/** The parts with no Shopify file to use instead: their own screen here is the way. */
const SET_HERE: readonly CopyFeed[] = ["countries", "shipping", "discounts", "look", "pages", "articles", "menus", "subscribers", "gift_cards"];

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
  /** *What to bring* (step 9): parts left out, and past orders of the last so many years (null: all). */
  start: (options?: { skip: CopyFeed[]; ordersYears: number | null }) => Promise<{ ok: boolean }>;
  advance: () => Promise<{ moving: boolean }>;
  bring: () => Promise<{ ok: boolean }>;
};

/**
 * *Copy my shop* (D445 step 4): one button, then a line for each part (products, customers, past orders, redirects) that says where it is;
 * while anything moves the page asks the server to go on every few seconds. When every part is checked, *Bring it over* saves them in order.
 * Each part's import has its own page (*See what will happen*), where Lisa sees every row; Homer needs none of it.
 */
export function ShopCopy({
  started,
  moving,
  ready,
  done,
  failed,
  rows,
  actions,
  privateHref,
  source = "shopify",
  parts,
}: {
  started: boolean;
  moving: boolean;
  ready: boolean;
  done: boolean;
  failed: number;
  rows: CopyRow[];
  actions: CopyActions;
  privateHref: string;
  /** The platform the shop is on: the problems are said of it (D446). */
  source?: "shopify" | "woocommerce";
  /** The parts this copy brings, for *What to bring* (all by default). */
  parts?: readonly CopyFeed[];
}) {
  const w = useAdminText("moving").copy;
  const problems = source === "woocommerce" ? w.problemsWoo : w.problems;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [skip, setSkip] = useState<CopyFeed[]>([]);
  const [years, setYears] = useState<number | null>(null);
  const startChosen = () => actions.start({ skip, ordersYears: years });

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
        <WhatToBring skip={skip} setSkip={setSkip} years={years} setYears={setYears} parts={parts} />
        <div>
          <button type="button" disabled={pending} className={primary} onClick={() => press(startChosen)}>
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
              {/* Gift cards are made on move day (D445 step 8): read now, nothing of them is here before. */}
              <span className="font-medium">{w.feeds[row.feed]}</span>: {row.feed === "gift_cards" && (row.stage === "done" || row.stage === "checked") ? w.onMoveDay : w.stages[row.stage]}
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
                {problems[row.problem]}{" "}
                <Link href={row.fileHref} className="underline underline-offset-2">
                  {SET_HERE.includes(row.feed) ? w.setHere : source === "woocommerce" ? w.filesWoo : w.files}
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
            <WhatToBring skip={skip} setSkip={setSkip} years={years} setYears={setYears} parts={parts} />
            <button type="button" disabled={pending} className={secondary} onClick={() => press(startChosen)}>
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

/** The parts a copy may leave out, in the order the page lists them. */
const CHOOSABLE: readonly CopyFeed[] = ["products", "collections", "customers", "subscribers", "orders", "gift_cards", "discounts", "pages", "articles", "menus", "redirects", "countries", "shipping", "look"];
const YEARS: readonly (number | null)[] = [null, 5, 2, 1];

/**
 * *What to bring* (D445 step 9): Lisa's, folded away; everything is brought unless she says otherwise. A part left out is nothing to copy,
 * and past orders can be only the last few years.
 */
function WhatToBring({
  skip,
  setSkip,
  years,
  setYears,
  parts,
}: {
  skip: CopyFeed[];
  setSkip: (s: CopyFeed[]) => void;
  years: number | null;
  setYears: (y: number | null) => void;
  parts?: readonly CopyFeed[];
}) {
  const w = useAdminText("moving").copy;
  return (
    <details className="text-sm">
      <summary className="w-fit cursor-pointer underline underline-offset-2">{w.choose.title}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className={hint}>{w.choose.text}</p>
        <fieldset className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          <legend className="sr-only">{w.choose.title}</legend>
          {CHOOSABLE.filter((feed) => !parts || parts.includes(feed)).map((feed) => (
            <label key={feed} className="flex items-center gap-2">
              <input type="checkbox" checked={!skip.includes(feed)} onChange={(e) => setSkip(e.target.checked ? skip.filter((f) => f !== feed) : [...skip, feed])} />
              {w.feeds[feed]}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 font-medium">
          {w.choose.orders}
          <select value={years ?? ""} onChange={(e) => setYears(e.target.value === "" ? null : Number(e.target.value))} className="min-h-10 w-fit rounded-md border border-line bg-card px-3 text-sm font-normal">
            {YEARS.map((y) => (
              <option key={y ?? "all"} value={y ?? ""}>
                {y === null ? w.choose.allOrders : countWords(y, w.choose.years)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}
