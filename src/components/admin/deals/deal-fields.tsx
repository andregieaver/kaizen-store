"use client";

import { fillWords } from "@/lib/admin-fill";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import type { WhoChoice } from "@/lib/deals";

import { WhoPicker } from "./who-picker";

const control = "min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";

/**
 * A deal's fields (S2, D464), in a new deal's form and a deal's own: what they might buy, who with and an estimate for Homer; the stage (a
 * new deal only), the owner and when it may close under More choices for Lisa.
 */
export function DealFields({
  words,
  currency,
  who,
  search,
  stages,
  stageId,
  team,
  ownerId,
  values,
}: {
  words: DealsMessages["form"];
  currency: string;
  who: WhoChoice | null;
  search: (query: string) => Promise<WhoChoice[]>;
  /** Each pipeline's stages to choose from; none on a deal's own page, where it moves on the board or by its stage. */
  stages: { pipeline: string; stages: { id: string; name: string }[] }[] | null;
  stageId: string;
  team: { id: string; name: string }[];
  ownerId: string | null;
  values: { title: string; estimate: string; expectedCloseOn: string };
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {words.title}
        <input name="title" required maxLength={200} defaultValue={values.title} className={control} />
        <span className="font-normal text-muted">{words.titleHint}</span>
      </label>
      <WhoPicker initial={who} search={search} words={words} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        {fillWords(words.estimate, { currency })}
        <input name="estimate" inputMode="decimal" defaultValue={values.estimate} className={`${control} max-w-xs`} />
        <span className="font-normal text-muted">{words.estimateHint}</span>
      </label>
      <details className="rounded-md border border-line p-3">
        <summary className="cursor-pointer text-sm font-medium">{words.more}</summary>
        <div className="mt-3 flex flex-col gap-4">
          {stages ? (
            <label className="flex flex-col gap-1 text-sm font-medium">
              {words.stage}
              <select name="stageId" defaultValue={stageId} className={control}>
                {stages.length === 1
                  ? stages[0].stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))
                  : stages.map((p) => (
                      <optgroup key={p.pipeline} label={p.pipeline}>
                        {p.stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
              </select>
            </label>
          ) : (
            <input type="hidden" name="stageId" value={stageId} />
          )}
          <label className="flex flex-col gap-1 text-sm font-medium">
            {words.owner}
            <select name="ownerId" defaultValue={ownerId ?? ""} className={control}>
              <option value="">—</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {words.expectedClose}
            <input type="date" name="expectedCloseOn" defaultValue={values.expectedCloseOn} className={`${control} max-w-xs`} />
          </label>
        </div>
      </details>
    </>
  );
}
