import "server-only";

import sharp from "sharp";

import { VISION_COLOURS, VISION_QUESTION, visionAnswerRight, visionChallenge, visionRefusalMessage, type VisionCheck } from "@/lib/ai-vision";

import { AiError, completeText, imagePart, type AiConnection } from "./ai";

/** A small picture of two bands, the upper in one colour and the lower in another. */
export async function challengePicture(top: string, bottom: string): Promise<Buffer> {
  const rgb = (name: string) => VISION_COLOURS.find((c) => c.name === name)!.rgb;
  const band = (name: string) => ({ create: { width: 96, height: 48, channels: 3 as const, background: { r: rgb(name)[0], g: rgb(name)[1], b: rgb(name)[2] } } });
  return sharp(band(top))
    .extend({ bottom: 48, background: { r: 0, g: 0, b: 0 } })
    .composite([{ input: await sharp(band(bottom)).png().toBuffer(), top: 48, left: 0 }])
    .png()
    .toBuffer();
}

/**
 * Asks a model to say what colours a small picture holds (D163): the one honest test that it sees pictures. `model` is tried in place of the
 * connection's own, so a name can be checked before it is saved; the provider and key are the saved ones. One cheap call, recorded as usage.
 */
export async function checkVision(connection: AiConnection, model: string, pick: () => number = Math.random): Promise<VisionCheck> {
  const challenge = visionChallenge(pick);
  const started = Date.now();
  try {
    const picture = await challengePicture(challenge.top, challenge.bottom);
    const trying: AiConnection = { ...connection, textModel: model };
    const { text } = await completeText(
      trying,
      [{ role: "user", content: [{ type: "text", text: VISION_QUESTION }, imagePart(trying, picture, "image/png")] }],
      { maxTokens: 400, timeoutMs: 40_000 },
    );
    if (visionAnswerRight(text, challenge)) return { ok: true, model, ms: Date.now() - started };
    return {
      ok: false,
      model,
      message: `${model} answered, but not with what is in the picture (“${text.trim().slice(0, 60)}”), so it does not really look at pictures. Choose another model.`,
    };
  } catch (error) {
    if (error instanceof AiError) return { ok: false, model, message: visionRefusalMessage(model, error.status ?? undefined) };
    return { ok: false, model, message: `${model} could not be checked right now. Try again.` };
  }
}

/** The settings pages' "Check that it sees pictures": the typed name (or, empty, the saved vision or text model) against the saved provider and key. */
export async function checkVisionFor(connection: AiConnection | null, typed: string): Promise<VisionCheck> {
  const name = typed.trim();
  if (!connection) return { ok: false, model: name, message: "Save a provider and key first, then check the model." };
  if (name.length > 200 || !/^[\w.:/@+-]*$/.test(name)) return { ok: false, model: name, message: "A model name has only letters, digits and . : / @ + - _." };
  const model = name || connection.visionModel || connection.textModel;
  if (!model) return { ok: false, model: "", message: "Name a model to check." };
  return checkVision(connection, model);
}
