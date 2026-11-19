"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { NOTICE_PATH_MS, noticeText, noticeWait, noticeWordKey, type NoticeKind } from "@/lib/assistant-notices";

import { useAdminText } from "./admin-text";

/** The AI manager's notices route (D350): `place` is a store's address name, `platform` or `all`. */
const FEED = "/admin/account/notices/feed";

type NoticeItem = {
  id: string;
  kind: NoticeKind;
  place: string | null;
  storeId: string | null;
  /** When it came, written by the feed in the person's language on its store's clock or the platform's (D812): the admin frame carries no date formatter. */
  when: string;
  facts: Record<string, string>;
  href: string;
  read: boolean;
  createdAt: string;
};

/**
 * How many notices wait in a place: asked when the admin opens, when the tab is shown again and when the path changes (at most once a minute);
 * every ten minutes in a tab nobody touches; every minute for ten minutes after the count was above zero or the assistant was used, and while
 * an approval waits (`noticeWait()`). Polling only, as the support inbox's safety net: nothing new to set up, and a missed answer is caught by the next.
 */
export function useNoticeCount(place: string): [number, () => void] {
  const [unread, setUnread] = useState(0);
  const pathname = usePathname();
  const activeAt = useRef<number | null>(null);
  const waiting = useRef(false);
  const askedAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  const again = useRef<() => void>(() => undefined);

  const ask = useCallback(() => {
    askedAt.current = Date.now();
    fetch(`${FEED}?place=${encodeURIComponent(place)}&count=1`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { unread?: number; waiting?: boolean } | null) => {
        if (typeof body?.unread === "number") {
          setUnread(body.unread);
          if (body.unread > 0) activeAt.current = Date.now();
          waiting.current = body.waiting === true;
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!mounted.current) return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          if (document.visibilityState === "visible") again.current();
        }, noticeWait({ now: Date.now(), activeAt: activeAt.current, waiting: waiting.current }));
      });
  }, [place]);

  useEffect(() => {
    again.current = ask;
  }, [ask]);

  useEffect(() => {
    mounted.current = true;
    ask();
    const onShow = () => {
      if (document.visibilityState === "visible") ask();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      mounted.current = false;
      window.clearTimeout(timer.current);
    };
  }, [ask]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (Date.now() - askedAt.current >= NOTICE_PATH_MS) ask();
  }, [pathname, ask]);

  const recount = useCallback(() => {
    activeAt.current = Date.now();
    ask();
  }, [ask]);
  return [unread, recount];
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
                    {item.when}
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
