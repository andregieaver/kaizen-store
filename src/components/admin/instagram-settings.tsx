import { adminDate } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import { NOTIFICATIONS_WORDS } from "@/lib/admin-words/notifications";
import type { InstagramStatus } from "@/server/instagram";
import { QuietActionForm } from "@/components/admin/quiet-action-form";

/**
 * The owner's Instagram connection (D560), for a store and for Kaizena Flow: connect (off to Instagram), the account and how its posts were
 * last read, its latest posts (through the site's own proxy), and disconnect. Plain forms posting server actions; works without a script.
 */
export function InstagramSettings({
  status,
  appOn,
  canEdit,
  lang,
  pictureBase,
  returned,
  connect,
  disconnect,
  timeZone,
  pageHref = null,
}: {
  status: InstagramStatus | null;
  appOn: boolean;
  canEdit: boolean;
  lang: AdminLang;
  /** The proxy's path for the owner's pictures, `/api/instagram/{owner}`. */
  pictureBase: string;
  returned: keyof ReturnType<typeof words>["returned"] | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Where the shop's Facebook Page is connected (Social posts), when Facebook can be connected here: its Instagram comes with it. */
  pageHref?: string | null;
  /** The store's time zone, or `PLATFORM_TIME_ZONE` for Kaizena Flow's own: when the posts were last read, on that clock (D812). */
  timeZone: string;
}) {
  const w = words(lang);
  const card = "flex flex-col gap-3 rounded-lg border border-line bg-card p-5";
  const when = status?.fetchedAt ? adminDate(timeZone, status.fetchedAt, "dayTime", lang) : w.never;
  return (
    <div className="flex flex-col gap-6">
      {returned && (
        <p role="status" className={`rounded-md px-4 py-3 text-sm ${returned === "connected" ? "bg-positive-soft text-positive-text" : "bg-warning-soft text-warning-text"}`}>
          {w.returned[returned]}
        </p>
      )}
      {!appOn && !status && !pageHref ? (
        <p className="text-sm text-muted">{w.notSetUp}</p>
      ) : status ? (
        <section className={card} aria-labelledby="instagram-account">
          <h2 id="instagram-account" className="text-title text-ink">
            {fillWords(w.connected, { name: status.username })}
          </h2>
          <p className="text-sm text-muted">{fillWords(w.counts, { n: status.posts, when })}</p>
          {status.via === "facebook" && <p className="text-sm text-muted">{w.viaPage}</p>}
          {status.problem && <p className="text-sm text-warning-text">{fillWords(w.problem, { problem: status.problem })}</p>}
          {status.recent.length > 0 && (
            <>
              <h3 className="text-sm font-medium">{w.recent}</h3>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {status.recent.map((post) => (
                  <li key={post.id}>
                    <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element -- served by the site's own proxy, already sized by Instagram */}
                      <img src={`${pictureBase}/${post.id}`} alt="" width={160} height={160} loading="lazy" className="aspect-square w-full rounded-md bg-sunken object-cover" />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {appOn && status.via === "instagram" && (
                <QuietActionForm action={connect}>
                  <button type="submit" className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken">
                    {w.reconnect}
                  </button>
                </QuietActionForm>
              )}
              {/* An account that came with the Facebook Page goes with the Page (Social posts). */}
              {status.via === "instagram" && (
                <>
                  <QuietActionForm action={disconnect}>
                    <button type="submit" className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium text-danger-text hover:bg-sunken">
                      {w.disconnect}
                    </button>
                  </QuietActionForm>
                  <p className="w-full text-xs text-muted">{w.disconnectHint}</p>
                </>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">{w.readOnly}</p>
          )}
        </section>
      ) : (
        <section className={card}>
          {appOn && <p className="text-sm">{w.connectHint}</p>}
          {canEdit && appOn ? (
            <QuietActionForm action={connect}>
              <button type="submit" className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
                {w.connect}
              </button>
            </QuietActionForm>
          ) : !canEdit ? (
            <p className="text-sm text-muted">{w.readOnly}</p>
          ) : null}
          {pageHref && (
            <p className="text-sm">
              {w.throughPage}{" "}
              <a href={pageHref} className="font-medium underline">
                {w.throughPageLink}
              </a>
            </p>
          )}
        </section>
      )}
    </div>
  );
}

const words = (lang: AdminLang) => NOTIFICATIONS_WORDS[lang].instagram;

/** What the callback's `?instagram=` says, if it is one of the known answers. */
export const instagramReturned = (value: unknown): "connected" | "cancelled" | "failed" | null =>
  value === "connected" || value === "cancelled" || value === "failed" ? value : null;
