/**
 * Shrinks a picture in the browser before upload: at most `maxSize` pixels on the long side, as WebP (or JPEG where the
 * browser cannot write WebP), at the lowest quality that still looks the same (D213, `compressPicture()`). Drawn anew, so
 * camera metadata such as location is left behind.
 */
export { shrinkImage } from "./image-compress";

/**
 * A square PNG icon of `size` pixels from a picture (D62): the picture fitted
 * inside, centred, on a transparent background. SVGs are drawn through an
 * image element, as not every browser makes bitmaps of them.
 */
export async function squareIcon(file: File, size: number): Promise<Blob> {
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let done = () => {};
  if (file.type === "image/svg+xml") {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    await image.decode();
    source = image;
    // An SVG without a size of its own fills the square.
    width = image.naturalWidth || size;
    height = image.naturalHeight || size;
    done = () => URL.revokeObjectURL(url);
  } else {
    const bitmap = await createImageBitmap(file);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    done = () => bitmap.close();
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot resize pictures.");
  const scale = Math.min(size / width, size / height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  context.imageSmoothingQuality = "high";
  context.drawImage(source, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
  done();
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("The picture could not be converted.");
  return png;
}

/**
 * A profile picture (D97): the middle square of a picture, `size` pixels
 * wide, as WebP (or JPEG where the browser cannot write WebP), without the
 * camera's metadata.
 */
export async function squarePicture(file: File, size: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(size, side);
  canvas.height = canvas.width;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot resize pictures.");
  context.imageSmoothingQuality = "high";
  context.drawImage(
    bitmap,
    Math.floor((bitmap.width - side) / 2),
    Math.floor((bitmap.height - side) / 2),
    side,
    side,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg");
  if (!jpeg) throw new Error("The picture could not be converted.");
  return jpeg;
}
