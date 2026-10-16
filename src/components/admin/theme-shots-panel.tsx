import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
import { StarterPictureField } from "@/components/admin/starter-picture-field";
import type { Upload } from "@/components/admin/image-upload";
import { HIGHLIGHT_KINDS, HIGHLIGHT_NAMES } from "@/lib/theme-highlights";
import { OWN_SLOTS, OWN_SLOT_NAMES, type OwnPictures, type OwnSlot } from "@/lib/theme-store";
import type { ShotKind } from "@/lib/theme-shots";
import type { ShotStatus } from "@/server/theme-shots";

/** A look of the theme as the panel names it: its own (`key` null) or a preset. */
export type ShotLook = { key: string | null; name: string };

const KIND_WORDS: Record<ShotKind, string> = { computer: "Computer", phone: "Phone" };

const STATUS: Record<ShotStatus["status"], { words: string; signal: "positive" | "neutral" | "insight" | "danger" }> = {
  done: { words: "Made", signal: "positive" },
  waiting: { words: "Waiting to be made", signal: "neutral" },
  running: { words: "Being made", signal: "insight" },
  failed: { words: "Could not be made", signal: "danger" },
  superseded: { words: "Replaced", signal: "neutral" },
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

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
}: {
  looks: ShotLook[];
  shots: ShotStatus[];
  published: boolean;
  retry: (state: FormState) => Promise<FormState>;
  /** The admin's own pictures in place of made ones (step 3), and the action that sets or clears one, bound to the theme. */
  own?: OwnPictures;
  ownAction?: (slot: OwnSlot, state: FormState, formData: FormData) => Promise<FormState>;
  upload?: Upload;
}) {
  const of = (key: string | null, kind: ShotKind) => shots.find((shot) => shot.variation === key && shot.kind === kind) ?? null;
  const highlights = shots.find((shot) => shot.variation === null && shot.kind === "highlights") ?? null;
  const failed = shots.filter((shot) => shot.status === "failed").length;
  const waiting = shots.filter((shot) => shot.status === "waiting" || shot.status === "running").length;
  const inUse = OWN_SLOTS.filter((slot) => own[slot]).length;
  return (
    <Card
      title="Pictures"
      description={
        published
          ? "Photographs of each look on its demo store, taken after every Publish, for the theme store's cards, pages and share images. Nothing to do: publishing is enough."
          : "Each look is photographed on its demo store once the theme is published, for the theme store's cards, pages and share images."
      }
      aside={waiting > 0 ? `${waiting} being made` : undefined}
    >
      <ul className="flex flex-col divide-y divide-line" data-theme-shots="">
        {looks.map((look) => (
          <li key={look.key ?? ""} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
            <p className="text-body-strong text-ink">{look.key === null ? `${look.name} (its own look)` : look.name}</p>
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
                        alt={`${look.name} on a ${kind}`}
                        width={picture.width}
                        height={picture.height}
                        loading="lazy"
                        className={`rounded-panel border border-line object-cover object-top ${kind === "computer" ? "aspect-[4/3] w-52" : "aspect-[390/844] w-24"}`}
                      />
                    ) : (
                      <div aria-hidden className={`rounded-panel border border-dashed border-line bg-sunken ${kind === "computer" ? "aspect-[4/3] w-52" : "aspect-[390/844] w-24"}`} />
                    )}
                    <figcaption className="flex flex-col items-start gap-1 text-caption text-muted">
                      <span>{KIND_WORDS[kind]}</span>
                      {shot ? <Chip signal={STATUS[shot.status].signal}>{STATUS[shot.status].words}</Chip> : <Chip>{published ? "Waiting to be made" : "Not made yet"}</Chip>}
                      {shot?.status === "done" && shot.finishedAt && (
                        <span>
                          Version {shot.version}, {when(shot.finishedAt)} UTC
                        </span>
                      )}
                      {shot?.status === "failed" && shot.problem && <span className="max-w-52 text-danger-text">{shot.problem}</span>}
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
          <p className="text-body-strong text-ink">Highlights</p>
          {highlights ? <Chip signal={STATUS[highlights.status].signal}>{STATUS[highlights.status].words}</Chip> : <Chip>{published ? "Made after the photographs" : "Not made yet"}</Chip>}
        </div>
        {highlights?.status === "done" && (
          <div className="flex flex-wrap gap-4">
            {HIGHLIGHT_KINDS.map((kind) => {
              const picture = highlights.pictures[kind];
              return picture ? (
                // eslint-disable-next-line @next/next/no-img-element -- a made picture in Kaizena Flow's own bucket
                <img key={kind} src={picture.url} alt={HIGHLIGHT_NAMES[kind]} width={picture.width} height={picture.height} loading="lazy" className="aspect-[8/5] w-52 rounded-panel border border-line object-cover" />
              ) : null;
            })}
          </div>
        )}
        {highlights?.status === "failed" && highlights.problem && <p className="text-caption text-danger-text">{highlights.problem}</p>}
      </div>
      {/* Lisa's step: any made picture the theme store shows can be replaced with the admin's own, and put back (step 3). */}
      {ownAction && upload && (
        // Never opened from the props: a value that changed after a save would close it under the person.
        <details className="mt-4 border-t border-line pt-4" data-own-pictures="">
          <summary className="cursor-pointer text-body-strong text-ink">
            Use your own pictures
            {inUse > 0 && <span className="ml-2 text-caption text-muted">{inUse === 1 ? "1 in use" : `${inUse} in use`}</span>}
          </summary>
          <p className="mt-2 text-caption text-muted">
            Put your own picture in place of a made one; remove it to show the made one again. The card&apos;s own picture is the main picture under Details.
          </p>
          <ul className="mt-3 flex flex-col gap-4">
            {OWN_SLOTS.map((slot) => {
              const made = slot === "share" ? of(null, "computer")?.pictures.share : highlights?.pictures[slot];
              return (
                <li key={slot} className="flex flex-col gap-2" data-own-slot={slot}>
                  <p className="text-body-strong text-ink">{OWN_SLOT_NAMES[slot]}</p>
                  <p className="text-caption text-muted">{own[slot] ? "Your own picture shows in place of the made one." : made ? "The made picture shows." : "Nothing made yet."}</p>
                  <ActionForm action={ownAction.bind(null, slot)} className="flex flex-col gap-2">
                    <StarterPictureField initial={own[slot] ?? null} upload={upload} />
                    <div>
                      <SubmitButton variant="secondary">Save</SubmitButton>
                    </div>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {failed > 0 && (
        <ActionForm action={retry} className="mt-4 flex flex-wrap items-center gap-3">
          <SubmitButton>Try again</SubmitButton>
          <span className="text-caption text-muted">
            {failed === 1 ? "One picture" : `${failed} pictures`} could not be made after three tries.
          </span>
        </ActionForm>
      )}
    </Card>
  );
}
