import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
import { StarterPictureField } from "@/components/admin/starter-picture-field";
import type { Upload } from "@/components/admin/image-upload";
import { HIGHLIGHT_KINDS } from "@/lib/theme-highlights";
import { OWN_SLOTS, type OwnPictures, type OwnSlot } from "@/lib/theme-store";
import type { ShotKind } from "@/lib/theme-shots";
import type { ShotStatus } from "@/server/theme-shots";
import { countWords, fillWords } from "@/lib/admin-fill";
import { platformSiteEn, type PlatformSiteMessages } from "@/lib/admin-messages/platform-site.en";

/** A look of the theme as the panel names it: its own (`key` null) or a preset. */
export type ShotLook = { key: string | null; name: string };


const SIGNALS: Record<ShotStatus["status"], "positive" | "neutral" | "insight" | "danger"> = {
  done: "positive",
  waiting: "neutral",
  running: "insight",
  failed: "danger",
  superseded: "neutral",
};

const whenIn = (locale: string) => (iso: string) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/**
 * A theme's photographs on its page in the platform's admin (`docs/theme-showcase-phase-2.md` step 1): each look at each width, what it
 * shows and of which version, or that it is being made, or why it could not be; *Try again* for those that could not. Homer has nothing to do
 * here (publishing is enough); Lisa sees every unit.
 */
export function ThemeShotsPanel({
  looks,
  shots,
  published,
  retry,
  own = {},
  ownAction,
  upload,
  words: w = platformSiteEn.shots,
  tables = platformSiteEn.tables,
  locale = "en-GB",
}: {
  looks: ShotLook[];
  shots: ShotStatus[];
  published: boolean;
  retry: (state: FormState) => Promise<FormState>;
  /** The admin's own pictures in place of made ones (step 3), and the action that sets or clears one, bound to the theme. */
  own?: OwnPictures;
  ownAction?: (slot: OwnSlot, state: FormState, formData: FormData) => Promise<FormState>;
  upload?: Upload;
  words?: PlatformSiteMessages["shots"];
  tables?: PlatformSiteMessages["tables"];
  /** `ADMIN_LANG_FACTS[lang].locale`, for the dates. */
  locale?: string;
}) {
  const when = whenIn(locale);
  const of = (key: string | null, kind: ShotKind) => shots.find((shot) => shot.variation === key && shot.kind === kind) ?? null;
  const highlights = shots.find((shot) => shot.variation === null && shot.kind === "highlights") ?? null;
  const failed = shots.filter((shot) => shot.status === "failed").length;
  // Units resting after a round of failed tries (D284): tried again by themselves, or now with *Try again*.
  const resting = shots.filter((shot) => shot.status === "waiting" && shot.retryAt).length;
  const waiting = shots.filter((shot) => shot.status === "waiting" || shot.status === "running").length;
  const inUse = OWN_SLOTS.filter((slot) => own[slot]).length;
  return (
    <Card
      title={w.title}
      description={published ? w.published : w.unpublished}
      aside={waiting > 0 ? fillWords(w.beingMade, { n: waiting }) : undefined}
    >
      <ul className="flex flex-col divide-y divide-line" data-theme-shots="">
        {looks.map((look) => (
          <li key={look.key ?? ""} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
            <p className="text-body-strong text-ink">{look.key === null ? fillWords(w.ownLook, { name: look.name }) : look.name}</p>
            <div className="flex flex-wrap items-start gap-6">
              {(["computer", "phone"] as const).map((kind) => {
                const shot = of(look.key, kind);
                const picture = shot?.status === "done" ? (kind === "computer" ? (shot.pictures.card ?? shot.pictures.screen) : shot.pictures.screen) : null;
                return (
                  <figure key={kind} className="flex flex-col gap-2" data-shot-kind={kind}>
                    {picture ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a made picture in Kaizena Flow's own bucket
                      <img
                        src={picture.url}
                        alt={fillWords(w.onA[kind], { name: look.name })}
                        width={picture.width}
                        height={picture.height}
                        loading="lazy"
                        className={`rounded-panel border border-line object-cover object-top ${kind === "computer" ? "aspect-[4/3] w-52" : "aspect-[390/844] w-24"}`}
                      />
                    ) : (
                      <div aria-hidden className={`rounded-panel border border-dashed border-line bg-sunken ${kind === "computer" ? "aspect-[4/3] w-52" : "aspect-[390/844] w-24"}`} />
                    )}
                    <figcaption className="flex flex-col items-start gap-1 text-caption text-muted">
                      <span>{w.kinds[kind]}</span>
                      {shot ? <Chip signal={SIGNALS[shot.status]}>{w.status[shot.status]}</Chip> : <Chip>{published ? w.status.waiting : w.notMade}</Chip>}
                      {shot?.status === "done" && shot.finishedAt && (
                        <span>{fillWords(w.version, { version: shot.version, when: when(shot.finishedAt) })}</span>
                      )}
                      {shot?.status === "failed" && shot.problem && <span className="max-w-52 text-danger-text">{shot.problem}</span>}
                      {shot?.status === "waiting" && shot.retryAt && (
                        <span className="max-w-52">
                          {fillWords(w.triedAgain, { when: when(shot.retryAt) })}
                          {shot.problem ? fillWords(w.lastTime, { problem: shot.problem }) : ""}
                        </span>
                      )}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {/* The three highlights, composed from the theme's own look once its two photographs are made (step 2). */}
      <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4" data-theme-highlights="">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body-strong text-ink">{w.highlights}</p>
          {highlights ? <Chip signal={SIGNALS[highlights.status]}>{w.status[highlights.status]}</Chip> : <Chip>{published ? w.afterPhotos : w.notMade}</Chip>}
        </div>
        {highlights?.status === "done" && (
          <div className="flex flex-wrap gap-4">
            {HIGHLIGHT_KINDS.map((kind) => {
              const picture = highlights.pictures[kind];
              return picture ? (
                // eslint-disable-next-line @next/next/no-img-element -- a made picture in Kaizena Flow's own bucket
                <img key={kind} src={picture.url} alt={tables.highlights[kind]} width={picture.width} height={picture.height} loading="lazy" className="aspect-[8/5] w-52 rounded-panel border border-line object-cover" />
              ) : null;
            })}
          </div>
        )}
        {highlights?.status === "failed" && highlights.problem && <p className="text-caption text-danger-text">{highlights.problem}</p>}
        {highlights?.status === "waiting" && highlights.retryAt && (
          <p className="text-caption text-muted">
            {fillWords(w.triedAgain, { when: when(highlights.retryAt) })}
            {highlights.problem ? fillWords(w.lastTime, { problem: highlights.problem }) : ""}
          </p>
        )}
      </div>
      {/* Lisa's step: any made picture the theme store shows can be replaced with the admin's own, and put back (step 3). */}
      {ownAction && upload && (
        // Never opened from the props: a value that changed after a save would close it under the person.
        <details className="mt-4 border-t border-line pt-4" data-own-pictures="">
          <summary className="cursor-pointer text-body-strong text-ink">
            {w.own}
            {inUse > 0 && <span className="ml-2 text-caption text-muted">{countWords(inUse, w.ownInUse)}</span>}
          </summary>
          <p className="mt-2 text-caption text-muted">{w.ownNote}</p>
          <ul className="mt-3 flex flex-col gap-4">
            {OWN_SLOTS.map((slot) => {
              const made = slot === "share" ? of(null, "computer")?.pictures.share : highlights?.pictures[slot];
              return (
                <li key={slot} className="flex flex-col gap-2" data-own-slot={slot}>
                  <p className="text-body-strong text-ink">{tables.ownSlots[slot]}</p>
                  <p className="text-caption text-muted">{own[slot] ? w.ownShows : made ? w.madeShows : w.nothingMade}</p>
                  <ActionForm action={ownAction.bind(null, slot)} className="flex flex-col gap-2">
                    <StarterPictureField initial={own[slot] ?? null} upload={upload} />
                    <div>
                      <SubmitButton variant="secondary">{w.save}</SubmitButton>
                    </div>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {failed + resting > 0 && (
        <ActionForm action={retry} className="mt-4 flex flex-wrap items-center gap-3">
          <SubmitButton>{w.retry}</SubmitButton>
          <span className="text-caption text-muted">
            {failed > 0 ? countWords(failed, w.failed) : countWords(resting, w.resting)}
          </span>
        </ActionForm>
      )}
    </Card>
  );
}
