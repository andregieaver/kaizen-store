/**
 * Shrinks a picture in the browser before upload: at most `maxSize` pixels on
 * the long side, as WebP (or JPEG where the browser cannot write WebP). This
 * keeps storefront pages light and strips camera metadata such as location.
 */
export async function shrinkImage(file: File, maxSize: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot resize pictures.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode("image/webp");
  // Some browsers silently fall back to PNG when they cannot write WebP.
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg");
  if (!jpeg) throw new Error("The picture could not be converted.");
  return jpeg;
}
