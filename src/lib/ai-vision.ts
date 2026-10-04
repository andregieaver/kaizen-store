/**
 * Which model looks at pictures (D163), and how to tell that one does.
 *
 * A text model that cannot take pictures either refuses a message that holds one (HTTP 400) or, worse, answers as if it had seen it. So
 * "does it see?" is asked of the model itself: it is shown a small picture of two coloured bands and asked which colours they are. The
 * colours are drawn at random for each check, so a model that only guesses passes one check in twelve and none twice in a row.
 */

export const VISION_COLOURS = [
  { name: "red", rgb: [220, 38, 38] },
  { name: "green", rgb: [22, 163, 74] },
  { name: "blue", rgb: [37, 99, 235] },
  { name: "yellow", rgb: [250, 204, 21] },
] as const;

export type VisionColour = (typeof VISION_COLOURS)[number]["name"];
export type VisionChallenge = { top: VisionColour; bottom: VisionColour };

/** Two different colours: the upper band and the lower. `pick` returns a number from 0 up to (not including) 1. */
export function visionChallenge(pick: () => number = Math.random): VisionChallenge {
  const first = Math.min(VISION_COLOURS.length - 1, Math.floor(pick() * VISION_COLOURS.length));
  const rest = VISION_COLOURS.filter((_, index) => index !== first);
  const second = rest[Math.min(rest.length - 1, Math.floor(pick() * rest.length))];
  return { top: VISION_COLOURS[first].name, bottom: second.name };
}

export const VISION_QUESTION =
  "The picture has two horizontal bands. Which colour is the top band and which is the bottom band? Answer with the two colour names only, top one first, for example: purple, orange.";

/** Did the answer name the top colour and then the bottom one? Words in any case, anything else around them is ignored. */
export function visionAnswerRight(answer: string, challenge: VisionChallenge): boolean {
  const seen = (answer.toLowerCase().match(/\b(red|green|blue|yellow)\b/g) ?? []) as VisionColour[];
  return seen.length >= 2 && seen[0] === challenge.top && seen[1] === challenge.bottom;
}

export type VisionCheck = { ok: true; model: string; ms: number } | { ok: false; model: string; message: string };

/** What a provider's refusal of a picture is told as, so the owner knows what to do: choose another model. */
export function visionRefusalMessage(model: string, status: number | undefined): string {
  if (status === 400 || status === 404 || status === 415 || status === 422) {
    return `${model} did not accept a picture, so it cannot look at pictures. Choose another model, such as one of the suggestions.`;
  }
  return `${model} did not answer (${status ? `error ${status}` : "no answer"}). Try again, or choose another model.`;
}

/** The model that looks at pictures for a settings row: its own, else the text model. */
export const visionModelOf = (settings: { visionModel: string | null; textModel: string | null }): string | null => settings.visionModel ?? settings.textModel;

/** Is this model one the provider's list says takes pictures? Only a hint for the label: the check decides. */
export function suggestedVision(models: { model: string; note: string }[], model: string | null): { model: string; note: string } | null {
  return model ? (models.find((m) => m.model === model) ?? null) : null;
}

/** One line for the settings pages: which model looks at pictures, or that none does and what that costs. `whose` is "Kaizen's AI" or "Your AI". */
export function pictureLine(settings: { enabled: boolean; visionModel: string | null; textModel: string | null } | null, whose: string, choose = "Choose a model that sees pictures below."): string {
  const model = settings?.enabled ? visionModelOf(settings) : null;
  return model
    ? `${whose} looks at pictures with ${model}${settings?.visionModel ? "" : " (the text model: check below that it sees pictures)"}.`
    : `${whose} has no model that looks at pictures: copying a page is corrected by measuring alone and alt texts are not written. ${choose}`;
}
