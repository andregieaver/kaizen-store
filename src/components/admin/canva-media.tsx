"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import type { CanvaDesignItem } from "@/server/canva";
import type { MediaItem } from "@/server/media-library";

import { useAdminText } from "./admin-text";
import { Modal } from "./modal";
import { CARD_CLASS } from "@/components/admin/ui/card";

/**
 * Canva in the media library (D898, `docs/design-tools.md` C1): the person's own Canva, connected once. *Import from Canva* brings a design
 * in as a picture; *Edit in Canva* on a picture opens it in their Canva, whose *Return* button comes back here, where the edited copy is
 * brought in beside the original. The server's work is `src/server/canva.ts`, asked through the library's `/media/canva` route.
 */
export type CanvaTools = {
  /** The library's Canva route (`/admin/{store}/media/canva`, or Kaizena Flow's). */
  endpoint: string;
  /** The person's Canva, or null while it is not connected. `problem`: Canva no longer takes the connection. */
  account: { name: string; problem: boolean } | null;
  /** Starts connecting: the browser goes to Canva and comes back to this library. */
  connect: () => Promise<{ ok: false; problem: string }>;
  /** The person's latest edit of each picture here, by the picture's id, to bring it back again. */
  edits: Record<string, string>;
  /** An edit Canva's *Return* just brought the person back from (`?canva=`), to bring into the library now. */
  returned: string | null;
  /** How a connect just ended (`?canva=connected`, `declined` or `failed`). */
  outcome: "connected" | "declined" | "failed" | null;
};

type Answer<T> = ({ ok: true } & T) | { ok: false; problem: string; reconnect?: boolean };

async function ask<T>(endpoint: string, body: unknown, failed: string): Promise<Answer<T>> {
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await response.json().catch(() => null)) as Answer<T> | null;
    return json ?? { ok: false, problem: failed };
  } catch {
    return { ok: false, problem: failed };
  }
}

const button = "min-h-10 rounded-pill border border-edge px-4 text-sm font-medium disabled:opacity-50";
const main = "min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hover disabled:opacity-50";

/** *Connect Canva*: one press, to Canva's consent page and back. */
function ConnectButton({ canva, primary = true }: { canva: CanvaTools; primary?: boolean }) {
  const w = useAdminText("websiteMedia").media.canva;
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className={primary ? main : button}
        onClick={() =>
          start(async () => {
            const result = await canva.connect();
            if (result && !result.ok) setProblem(result.problem);
          })
        }
        data-canva-connect
      >
        {w.connect}
      </button>
      {problem && (
        <p role="alert" className="w-full text-sm text-danger-text">
          {problem}
        </p>
      )}
    </>
  );
}

/**
 * The library's Canva card: who is connected and *Import from Canva*, or *Connect Canva*; and, when the person just came back from Canva, the
 * edited design brought in (once) with a way to open it.
 */
export function CanvaPanel({ canva, basePath, onOpen }: { canva: CanvaTools; basePath: string; onOpen: (id: string) => void }) {
  const w = useAdminText("websiteMedia").media.canva;
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [back, setBack] = useState<{ state: "working" } | { state: "done"; mediaId: string } | { state: "failed"; problem: string } | null>(canva.returned ? { state: "working" } : null);
  const asked = useRef(false);

  useEffect(() => {
    if (!canva.returned || asked.current) return;
    asked.current = true;
    void ask<{ mediaId: string }>(canva.endpoint, { do: "bring", editId: canva.returned }, w.problems.failed).then((answer) => {
      setBack(answer.ok ? { state: "done", mediaId: answer.mediaId } : { state: "failed", problem: answer.problem });
      // The address loses `canva=`, so a reload does not bring the design in a second time.
      router.replace(basePath);
      if (answer.ok) router.refresh();
    });
  }, [canva.returned, canva.endpoint, basePath, router, w.problems.failed]);

  const connected = canva.account && !canva.account.problem;
  return (
    <section aria-label={w.title} className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`} data-canva>
      {back && (
        <p role="status" className={`text-sm ${back.state === "failed" ? "text-danger-text" : "text-ink"}`} data-canva-return={back.state}>
          {back.state === "working" ? w.returning : back.state === "failed" ? back.problem : w.returned}{" "}
          {back.state === "done" && (
            <button type="button" className="underline" onClick={() => onOpen(back.mediaId)}>
              {w.open}
            </button>
          )}
        </p>
      )}
      {canva.outcome && (
        <p role="status" className={`text-sm ${canva.outcome === "connected" ? "text-positive-text" : "text-danger-text"}`}>
          {w.outcome[canva.outcome]}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-body-strong text-ink">{w.title}</h2>
          <p className="text-sm text-ink-2">
            {connected ? (canva.account?.name ? fillWords(w.connectedAs, { name: canva.account.name }) : w.connected) : canva.account?.problem ? w.reconnect : w.connectLead}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connected ? (
            <button type="button" className={button} onClick={() => setPicking(true)} data-canva-import>
              {w.import}
            </button>
          ) : (
            <ConnectButton canva={canva} primary={false} />
          )}
        </div>
      </div>
      {!connected && <p className="text-xs text-muted">{w.where}</p>}
      {picking && (
        <CanvaPicker
          endpoint={canva.endpoint}
          onClose={() => setPicking(false)}
          onImported={(mediaId) => {
            setPicking(false);
            router.refresh();
            onOpen(mediaId);
          }}
        />
      )}
    </section>
  );
}

/** *Import from Canva*: the person's designs, latest first or searched; a press brings a design's first page in as a picture. */
function CanvaPicker({ endpoint, onClose, onImported }: { endpoint: string; onClose: () => void; onImported: (mediaId: string) => void }) {
  const w = useAdminText("websiteMedia").media.canva;
  const id = useId();
  const [query, setQuery] = useState("");
  const [designs, setDesigns] = useState<CanvaDesignItem[] | null>(null);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = (search: string, after: string | null) =>
    start(async () => {
      setProblem(null);
      const answer = await ask<{ designs: CanvaDesignItem[]; continuation: string | null }>(endpoint, { do: "designs", query: search, continuation: after }, w.problems.failed);
      if (!answer.ok) {
        setProblem(answer.problem);
        return;
      }
      setDesigns((now) => (after ? [...(now ?? []), ...answer.designs] : answer.designs));
      setContinuation(answer.continuation);
    });

  const first = useRef(false);
  useEffect(() => {
    if (first.current) return;
    first.current = true;
    load("", null);
  });

  const bring = (designId: string) =>
    start(async () => {
      setImporting(designId);
      setProblem(null);
      const answer = await ask<{ mediaId: string }>(endpoint, { do: "import", designId }, w.problems.failed);
      setImporting(null);
      if (answer.ok) onImported(answer.mediaId);
      else setProblem(answer.problem);
    });

  return (
    <Modal open onClose={onClose} title={w.pickTitle} wide footer={<button type="button" onClick={onClose} className={button}>{w.close}</button>}>
      <div className="flex flex-col gap-4">
        <form
          role="search"
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            load(query, null);
          }}
        >
          <label htmlFor={`${id}-q`} className="sr-only">
            {w.search}
          </label>
          <input
            id={`${id}-q`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={w.search}
            maxLength={255}
            className="min-h-10 min-w-0 flex-1 rounded-md border border-line bg-card px-3 text-sm"
          />
          <button type="submit" disabled={pending} className={button}>
            {w.searchButton}
          </button>
        </form>
        <p className="text-xs text-muted">{w.firstPage}</p>
        {problem && (
          <p role="alert" className="text-sm text-danger-text">
            {problem}
          </p>
        )}
        {designs === null ? (
          <p className="text-sm text-muted" role="status">
            {w.loading}
          </p>
        ) : designs.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3" data-canva-designs>
            {designs.map((design) => (
              <li key={design.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => bring(design.id)}
                  className="flex w-full flex-col gap-1.5 rounded-lg border border-line p-2 text-left hover:bg-sunken disabled:opacity-60"
                >
                  <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-sunken">
                    {design.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Canva's thumbnail through our own signed address; not a site picture.
                      <img src={design.thumbnail} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                    ) : null}
                  </span>
                  <span className="truncate text-sm text-ink">{design.title || w.untitled}</span>
                  <span className="text-xs text-muted">{importing === design.id ? w.importing : design.pages ? countWords(design.pages, w.pages) : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {continuation && (
          <button type="button" disabled={pending} onClick={() => load(query, continuation)} className={`${button} self-start`}>
            {w.more}
          </button>
        )}
      </div>
    </Modal>
  );
}

/**
 * *Edit in Canva* in a picture's details: opens it in the person's Canva (the browser goes there; Canva's *Return* comes back to the
 * library), or brings the latest version of an earlier edit in again. Without a connection, *Connect Canva*.
 */
export function EditInCanva({ item, canva }: { item: MediaItem; canva: CanvaTools }) {
  const w = useAdminText("websiteMedia").media.canva;
  const id = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [brought, setBrought] = useState(false);
  const connected = canva.account && !canva.account.problem;
  const earlier = canva.edits[item.id] ?? null;
  return (
    <section aria-labelledby={`${id}-canva`} className="flex flex-col gap-2 text-sm" data-edit-in-canva>
      <h3 id={`${id}-canva`} className="text-body-strong text-ink">
        {w.edit}
      </h3>
      <p className="text-muted">{connected ? w.editLead : canva.account?.problem ? w.reconnect : w.connectLead}</p>
      <div className="flex flex-wrap items-center gap-2">
        {connected ? (
          <>
            <button
              type="button"
              disabled={pending || opening}
              className={button}
              onClick={() =>
                start(async () => {
                  setProblem(null);
                  const answer = await ask<{ url: string }>(canva.endpoint, { do: "edit", mediaId: item.id }, w.problems.failed);
                  if (answer.ok) {
                    setOpening(true);
                    window.location.assign(answer.url);
                  } else setProblem(answer.problem);
                })
              }
            >
              {pending || opening ? w.opening : w.edit}
            </button>
            {earlier && (
              <button
                type="button"
                disabled={pending || opening}
                className={button}
                title={w.againLead}
                onClick={() =>
                  start(async () => {
                    setProblem(null);
                    const answer = await ask<{ mediaId: string }>(canva.endpoint, { do: "bring", editId: earlier }, w.problems.failed);
                    if (answer.ok) {
                      setBrought(true);
                      router.refresh();
                    } else setProblem(answer.problem);
                  })
                }
              >
                {w.again}
              </button>
            )}
          </>
        ) : (
          <ConnectButton canva={canva} primary={false} />
        )}
      </div>
      {brought && <p role="status">{w.returned}</p>}
      {problem && (
        <p role="alert" className="text-danger-text">
          {problem}
        </p>
      )}
    </section>
  );
}

/**
 * The person's Canva as a card (D898), on the store's Integrations and Account → Connected apps: who is connected, where Canva keeps designs,
 * and *Connect Canva* or *Disconnect*, with the way to the media library where it is used.
 */
export function CanvaAccountCard({
  account,
  connect,
  disconnect,
  library,
}: {
  account: { name: string; problem: boolean } | null;
  connect: () => Promise<{ ok: false; problem: string }>;
  disconnect: () => Promise<void>;
  /** The media library to go to, with its words; none on the account's own page. */
  library?: { href: string; label: string };
}) {
  const w = useAdminText("websiteMedia").media.canva;
  const [pending, start] = useTransition();
  const connected = account && !account.problem;
  return (
    <section aria-label={w.title} className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`} data-canva-account>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-xl">
          <h2 className="text-body-strong text-ink">{w.title}</h2>
          <p className="text-sm text-ink-2">
            {connected ? (account?.name ? fillWords(w.connectedAs, { name: account.name }) : w.connected) : account?.problem ? w.reconnect : w.connectLead}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connected ? (
            <>
              {library && (
                <a href={library.href} className={main}>
                  {library.label}
                </a>
              )}
              <button type="button" disabled={pending} className={button} onClick={() => start(() => disconnect())}>
                {w.disconnect}
              </button>
            </>
          ) : (
            <ConnectButton canva={{ endpoint: "", account, connect, edits: {}, returned: null, outcome: null }} />
          )}
        </div>
      </div>
      <p className="text-xs text-muted">{w.where}</p>
    </section>
  );
}
