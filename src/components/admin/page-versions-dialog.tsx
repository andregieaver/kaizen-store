"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { PageContent } from "@/lib/page-content";
import { VERSIONS_KEPT, type PageVersionItem } from "@/lib/page-versions";
import { compareVersions, type PageDifference } from "@/lib/version-compare";

import { useAdminLang, useAdminText } from "./admin-text";
import { Modal } from "./modal";
import { VersionDifferences } from "./version-differences";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";

const secondary = "min-h-10 rounded-pill border border-edge px-4 text-sm hover:bg-sunken disabled:opacity-50";
const small = "min-h-9 rounded-pill border border-edge px-3 text-sm hover:bg-sunken disabled:opacity-50";

const when = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * A page's versions (D305): every save, publish and change made on the live site, newest first, each with who and when. *Use this
 * version* puts it in the editor as unsaved changes (Undo takes it back, Save or Publish keeps it); nothing on the site changes here.
 */
export function PageVersionsDialog({
  open,
  onClose,
  list,
  read,
  onUse,
  current,
}: {
  open: boolean;
  onClose: () => void;
  list: () => Promise<PageVersionItem[]>;
  read: (version: string) => Promise<{ ok: true; content: string } | { ok: false; problem: string }>;
  onUse: (content: string, item: PageVersionItem) => void;
  /** The page in the editor now, for *Compare* (D358); none offers no comparing. */
  current?: PageContent;
}) {
  const [items, setItems] = useState<PageVersionItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [taking, setTaking] = useState<string | null>(null);
  // What the editor has that the version compared does not (D358).
  const [compared, setCompared] = useState<{ id: string; differences: PageDifference[] } | null>(null);
  // An answer for a dialog closed meanwhile is thrown away.
  const ticket = useRef(0);
  const w = useAdminText("builder").versions;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;

  // The list is asked for when the dialog opens, whatever function the editor passes on each render.
  const load = useEffectEvent((mine: number) => {
    setItems(null);
    setProblem(null);
    list()
      .then((found) => {
        if (mine === ticket.current) setItems(found);
      })
      .catch(() => {
        if (mine === ticket.current) setProblem(w.listFailed);
      });
  });
  useEffect(() => {
    if (!open) return;
    load(++ticket.current);
    return () => {
      ticket.current += 1;
    };
  }, [open]);

  const use = async (item: PageVersionItem) => {
    const mine = ticket.current;
    setTaking(item.id);
    setProblem(null);
    try {
      const result = await read(item.id);
      if (mine !== ticket.current) return;
      if (!result.ok) return setProblem(result.problem);
      onUse(result.content, item);
      onClose();
    } catch {
      if (mine === ticket.current) setProblem(w.readFailed);
    } finally {
      setTaking(null);
    }
  };

  const compare = async (item: PageVersionItem) => {
    if (!current) return;
    const mine = ticket.current;
    setTaking(item.id);
    setProblem(null);
    try {
      const result = await read(item.id);
      if (mine !== ticket.current) return;
      if (!result.ok) return setProblem(result.problem);
      setCompared({ id: item.id, differences: compareVersions(JSON.parse(result.content) as PageContent, current) });
    } catch {
      if (mine === ticket.current) setProblem(w.readFailed);
    } finally {
      setTaking(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={w.title}
      footer={
        <button type="button" onClick={onClose} className={secondary}>
          {w.close}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          {fillWords(w.intro, { n: VERSIONS_KEPT })}
        </p>
        {problem && (
          <p role="alert" className="rounded-panel border border-danger-line bg-danger-soft p-3 text-sm text-danger-text">
            {problem}
          </p>
        )}
        {items === null && !problem ? (
          <p role="status" className="text-sm">
            {w.reading}
          </p>
        ) : items && items.length === 0 ? (
          <p className="text-sm">{w.none}</p>
        ) : (
          <ol aria-label={w.listLabel} className="flex flex-col divide-y divide-line">
            {items?.map((item, index) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm text-ink">
                    {w.kinds[item.kind]}
                    {index === 0 && <span className="ml-2 text-xs text-muted">{w.newest}</span>}
                  </span>
                  <span className="text-xs text-muted">
                    {when(item.at, locale)}
                    {item.by ? ` · ${item.by}` : ""}
                    {item.title ? ` · ${item.title}` : ""}
                  </span>
                </div>
                {current && (
                  <button type="button" onClick={() => void compare(item)} disabled={taking !== null} className={small}>
                    {w.compare}
                  </button>
                )}
                <button type="button" onClick={() => void use(item)} disabled={taking !== null} className={small}>
                  {taking === item.id ? w.opening : w.use}
                </button>
                {compared?.id === item.id && (
                  <div className="flex basis-full flex-col gap-1">
                    {compared.differences.length === 0 ? (
                      <p className="text-sm text-muted">{w.sameAsEditor}</p>
                    ) : (
                      <>
                        <p className="text-sm text-muted">{w.differencesTitle}</p>
                        <VersionDifferences differences={compared.differences} />
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}
