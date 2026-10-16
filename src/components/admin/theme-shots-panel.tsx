import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
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
export function ThemeShotsPanel({ looks, shots, published, retry }: { looks: ShotLook[]; shots: ShotStatus[]; published: boolean; retry: (state: FormState) => Promise<FormState> }) {
  const of = (key: string | null, kind: ShotKind) => shots.find((shot) => shot.variation === key && shot.kind === kind) ?? null;
  const failed = shots.filter((shot) => shot.status === "failed").length;
  const waiting = shots.filter((shot) => shot.status === "waiting" || shot.status === "running").length;
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
