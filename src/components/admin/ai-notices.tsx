"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { NOTICE_POLL_MS, noticeText, noticeWordKey, type NoticeKind } from "@/lib/assistant-notices";

import { useAdminText } from "./admin-text";

/** The AI manager's notices route (D350): `place` is a store's address name, `platform` or `all`. */
const FEED = "/admin/account/notices/feed";

type NoticeItem = {
  id: string;
  kind: NoticeKind;
  place: string | null;
  storeId: string | null;
  facts: Record<string, string>;
  href: string;
  read: boolean;
  createdAt: string;
};

/**
 * How many notices wait in a place: asked when the admin opens, every minute while the tab is shown and at once when it is shown again.
 * Polling only, as the support inbox's safety net: nothing new to set up, and a missed answer is caught by the next.
 */
export function useNoticeCount(place: string): [number, () => void] {
  const [unread, setUnread] = useState(0);
  const ask = useCallback(() => {
    fetch(`${FEED}?place=${encodeURIComponent(place)}&count=1`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { unread?: number } | null) => {
        if (typeof body?.unread === "number") setUnread(body.unread);
      })
      .catch(() => undefined);
  }, [place]);
  useEffect(() => {
    ask();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") ask();
    }, NOTICE_POLL_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") ask();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [ask]);
  return [unread, ask];
}

/** The count on a button: nothing at zero, else the number with its words for screen readers. */
export function NoticeBadge({ count }: { count: number }) {
  const w = useAdminText("assistant").notices;
  if (count <= 0) return null;
  return (
    <span data-notice-count={count} className="inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-danger-soft px-1 text-caption text-danger-text tabular-nums">
      <span aria-hidden>{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{countWords(count, w.count)}</span>
    </span>
  );
}

/** A notice's words, from its kind's template and its facts. */
export function useNoticeWords() {
  const w = useAdminText("assistant").notices;
  return (item: Pick<NoticeItem, "kind" | "facts">) => {
    const key = noticeWordKey(item.kind, item.facts) as keyof typeof w.kinds;
    return noticeText(w.kinds[key] ?? w.kinds[item.kind], item.facts);
  };
}

/**
 * The list of a place's notices (the panel's, or every place's on the account's page): each opens its conversation or page and is marked
 * read as it opens; *Mark all as read* clears the count.
 */
export function NoticeList({ place, onOpen, onChange, showPlace = false }: { place: string; onOpen?: () => void; onChange?: () => void; showPlace?: boolean }) {
  const w = useAdminText("assistant").notices;
  const words = useNoticeWords();
  const [items, setItems] = useState<NoticeItem[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${FEED}?place=${encodeURIComponent(place)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { items?: NoticeItem[] } | null) => {
        if (live) setItems(body?.items ?? []);
      })
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [place]);

  const mark = (ids: string[] | "all") => {
    setItems((list) => list?.map((item) => (ids === "all" || ids.includes(item.id) ? { ...item, read: true } : item)) ?? list);
    void fetch(FEED, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ place, ...(ids === "all" ? {} : { ids }) }),
    })
      .then(() => onChange?.())
      .catch(() => undefined);
  };

  if (items === null) return <p className="p-4 text-sm text-muted" role="status">…</p>;
  return (
    <div className="flex flex-col gap-2" data-notices="">
      {items.length === 0 ? (
        <p className="p-4 text-sm text-muted">{w.none}</p>
      ) : (
        <>
          {items.some((item) => !item.read) && (
            <button type="button" onClick={() => mark("all")} className="self-end rounded-pill px-3 py-1.5 text-sm underline">
              {w.markAll}
            </button>
          )}
          <ul className="flex flex-col divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} data-notice={item.kind} data-read={item.read ? "" : undefined}>
                <Link
                  href={item.href}
                  onClick={() => {
                    if (!item.read) mark([item.id]);
                    onOpen?.();
                  }}
                  className="flex flex-col gap-0.5 rounded-pill px-4 py-2.5 hover:bg-sunken"
                >
                  <span className={`text-sm ${item.read ? "text-ink-2" : "text-body-strong text-ink"}`}>{words(item)}</span>
                  <span className="text-caption text-muted">
                    {showPlace && <>{fillWords(w.from, { place: item.place ?? w.kaizen })} · </>}
                    {new Date(item.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** The account menu's row (D350): every place's unread notices, linking to the account's page of them. */
export function MenuNotices({ label, href }: { label: string; href: string }) {
  const [unread] = useNoticeCount("all");
  return (
    <Link role="menuitem" href={href} className="flex min-h-10 items-center gap-2 rounded-pill px-3 text-sm hover:bg-sunken focus-visible:outline-2">
      {label}
      <span className="ml-auto">
        <NoticeBadge count={unread} />
      </span>
    </Link>
  );
}
