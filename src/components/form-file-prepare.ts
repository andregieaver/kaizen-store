import { FORM_PDF_BYTES, FORM_PICTURE_BYTES, FORM_PICTURE_SIZE } from "@/lib/form-files";

/**
 * A file a visitor picked for a form's file question (D738 F6b), made ready in the browser: a picture drawn again as a WebP (a JPEG where the
 * browser cannot write WebP) of at most `FORM_PICTURE_SIZE` pixels a side, a PDF as it is within its size, anything else refused. Imported by
 * `site-form.tsx` only when a file is picked, so a page's first scripts do not carry it.
 */
export async function prepareFile(file: File): Promise<File | "too_big" | "not_allowed"> {
  const base = file.name.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "file";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return file.size > FORM_PDF_BYTES ? "too_big" : new File([file], `${base}.pdf`, { type: "application/pdf" });
  if (!file.type.startsWith("image/")) return "not_allowed";
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return "not_allowed";
  }
  const scale = Math.min(1, FORM_PICTURE_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = (type: string) => new Promise<Blob | null>((done) => canvas.toBlob(done, type, 0.85));
  let out = await blob("image/webp");
  if (!out || out.type !== "image/webp") out = await blob("image/jpeg");
  if (!out) return "not_allowed";
  if (out.size > FORM_PICTURE_BYTES) return "too_big";
  return new File([out], `${base}.${out.type === "image/webp" ? "webp" : "jpg"}`, { type: out.type });
}

