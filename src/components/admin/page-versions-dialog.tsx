"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { VERSION_KIND_WORDS, VERSIONS_KEPT, type PageVersionItem } from "@/lib/page-versions";

import { Modal } from "./modal";

const secondary = "min-h-10 rounded-pill border border-edge px-4 text-sm hover:bg-sunken disabled:opacity-50";
const small = "min-h-9 rounded-pill border border-edge px-3 text-sm hover:bg-sunken disabled:opacity-50";

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

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
}: {
  open: boolean;
  onClose: () => void;
  list: () => Promise<PageVersionItem[]>;
  read: (version: string) => Promise<{ ok: true; content: string } | { ok: false; problem: string }>;
  onUse: (content: string, item: PageVersionItem) => void;
}) {
  const [items, setItems] = useState<PageVersionItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [taking, setTaking] = useState<string | null>(null);
  // An answer for a dialog closed meanwhile is thrown away.
  const ticket = useRef(0);

  // The list is asked for when the dialog opens, whatever function the editor passes on each render.
  const load = useEffectEvent((mine: number) => {
    setItems(null);
    setProblem(null);
    list()
      .then((found) => {
        if (mine === ticket.current) setItems(found);
      })
      .catch(() => {
        if (mine === ticket.current) setProblem("The versions could not be read. Try again.");
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
      if (mine === ticket.current) setProblem("This version could not be read. Try again.");
    } finally {
      setTaking(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Versions"
      footer={
        <button type="button" onClick={onClose} className={secondary}>
          Close
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Each save, publish and change made on the site is kept, the newest {VERSIONS_KEPT}. Using one puts it in the editor: nothing changes on the site until you save or publish, and Undo takes it back.
        </p>
        {problem && (
          <p role="alert" className="rounded-panel border border-danger-line bg-danger-soft p-3 text-sm text-danger-text">
            {problem}
          </p>
        )}
        {items === null && !problem ? (
          <p role="status" className="text-sm">
            Reading the versions…
          </p>
        ) : items && items.length === 0 ? (
          <p className="text-sm">No versions yet: the first is kept when the page is saved.</p>
        ) : (
          <ol aria-label="Versions, newest first" className="flex flex-col divide-y divide-line">
            {items?.map((item, index) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm text-ink">
                    {VERSION_KIND_WORDS[item.kind]}
                    {index === 0 && <span className="ml-2 text-xs text-muted">Newest</span>}
                  </span>
                  <span className="text-xs text-muted">
                    {when(item.at)}
                    {item.by ? ` · ${item.by}` : ""}
                    {item.title ? ` · ${item.title}` : ""}
                  </span>
                </div>
                <button type="button" onClick={() => void use(item)} disabled={taking !== null} className={small}>
                  {taking === item.id ? "Opening…" : "Use this version"}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}
