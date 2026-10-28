"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { LOOK_VERSIONS_KEPT, type LookVersionActions, type LookVersionItem } from "@/lib/look-versions";
import type { StoreTheme } from "@/lib/theme";
import { compareLooks, type LookArea } from "@/lib/version-compare";

import { useAdminLang, useAdminText } from "./admin-text";
import { Modal } from "./modal";
import { Button } from "./ui";

/**
 * Earlier looks of the store (wave 7 unit F, D340): every save of the live look in Design settings, the builder's Theme tab and its saved
 * colours, newest first, with what made it, who and when. *Use this version* hands its theme to the editor (`onUse`), which holds it as
 * unsaved changes; nothing on the site changes here.
 */
export function LookVersionsDialog({
  open,
  onClose,
  actions,
  onUse,
  current,
}: {
  open: boolean;
  onClose: () => void;
  actions: LookVersionActions;
  onUse: (theme: StoreTheme) => void;
  /** The look in the editor now, for *Compare* (D358); none offers no comparing. */
  current?: StoreTheme;
}) {
  const w = useAdminText("schedules").versions;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const [items, setItems] = useState<LookVersionItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [taking, setTaking] = useState<string | null>(null);
  // The areas a version differs in from the editor's look (D358), for the version compared.
  const [compared, setCompared] = useState<{ id: string; areas: LookArea[] } | null>(null);
  // An answer for a dialog closed meanwhile is thrown away.
  const ticket = useRef(0);

  const load = useEffectEvent((mine: number) => {
    setItems(null);
    setProblem(null);
    actions
      .list()
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

  const use = async (item: LookVersionItem) => {
    const mine = ticket.current;
    setTaking(item.id);
    setProblem(null);
    try {
      const result = await actions.read(item.id);
      if (mine !== ticket.current) return;
      if (!result.ok) return setProblem(result.problem);
      onUse(result.theme);
      onClose();
    } catch {
      if (mine === ticket.current) setProblem(w.readFailed);
    } finally {
      setTaking(null);
    }
  };
  const compare = async (item: LookVersionItem) => {
    if (!current) return;
    const mine = ticket.current;
    setTaking(item.id);
    setProblem(null);
    try {
      const result = await actions.read(item.id);
      if (mine !== ticket.current) return;
      if (!result.ok) return setProblem(result.problem);
      setCompared({ id: item.id, areas: compareLooks(result.theme, current) });
    } catch {
      if (mine === ticket.current) setProblem(w.readFailed);
    } finally {
      setTaking(null);
    }
  };
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  return (
    <Modal open={open} onClose={onClose} title={w.title} footer={<Button onClick={onClose}>{w.close}</Button>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">{fillWords(w.intro, { n: LOOK_VERSIONS_KEPT })}</p>
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
          <ol aria-label={w.listLabel} className="flex flex-col divide-y divide-line" data-look-versions="">
            {items?.map((item, index) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm text-ink">
                    {w.kinds[item.kind]}
                    {index === 0 && <span className="ml-2 text-xs text-muted">{w.newest}</span>}
                  </span>
                  <span className="text-xs text-muted">
                    {when(item.at)}
                    {item.by ? ` · ${item.by}` : ""}
                  </span>
                </div>
                {current && (
                  <Button kind="quiet" size="dense" onClick={() => void compare(item)} disabled={taking !== null}>
                    {w.compare}
                  </Button>
                )}
                <Button kind="quiet" size="dense" onClick={() => void use(item)} disabled={taking !== null}>
                  {taking === item.id ? w.opening : w.use}
                </Button>
                {compared?.id === item.id && (
                  <div className="basis-full text-sm" data-look-differences>
                    {compared.areas.length === 0 ? (
                      <p className="text-muted">{w.sameAsEditor}</p>
                    ) : (
                      <>
                        <p className="text-muted">{w.differencesTitle}</p>
                        <ul className="list-disc pl-5">
                          {compared.areas.map((area) => (
                            <li key={area}>{w.areas[area]}</li>
                          ))}
                        </ul>
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
