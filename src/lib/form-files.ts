import { readPicture } from "./review-pictures";

/**
 * Files sent with a form (D738 F6b, `docs/forms.md` 15.2), pure and free of zod so the site's form shares the limits. A form's `file` question
 * takes one picture or one PDF. No malware scanner is at hand, so what is taken is narrow: a picture is drawn again in the visitor's browser
 * as a WebP of at most `FORM_PICTURE_SIZE` pixels a side (which leaves its camera data and anything hidden in it behind) and checked here from
 * its own bytes; a PDF is checked to be one, whole, and to carry no scripts, launches or files of its own. The owner downloads it, never
 * opens it on the site.
 */

export const FORM_PICTURE_SIZE = 2000;
export const FORM_PICTURE_BYTES = 2_500_000;
export const FORM_PDF_BYTES = 3_000_000;
/** What one sending carries in files together: under the 4.5 MB a function takes. */
export const FORM_FILES_BYTES = 4_000_000;
/** File questions a form may have. */
export const FORM_FILE_QUESTIONS_MAX = 3;
export const FORM_FILE_NAME_MAX = 120;

export type FormFileType = "image/webp" | "image/jpeg" | "application/pdf";

/** A file kept with a response: its question, the name it had (made safe), its kind, size and where it is stored. */
export type FormFile = { question: string; name: string; type: FormFileType; bytes: number; path: string };

export const fileExtension = (type: FormFileType) => (type === "application/pdf" ? "pdf" : type === "image/webp" ? "webp" : "jpg");

/** The name a file is kept and downloaded under: its own without folders or odd characters, with the extension of what it is. */
export function safeFileName(name: string, type: FormFileType): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ._()-]+/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, FORM_FILE_NAME_MAX - 6);
  return `${base || "file"}.${fileExtension(type)}`;
}

const ascii = (b: Uint8Array, at: number, text: string) => [...text].every((c, i) => b[at + i] === c.charCodeAt(0));

/** Names in a PDF that run something, open something or carry files: a form's PDF has none (`/JS` also catches `/JavaScript`). */
export const PDF_ACTIVE = ["/JS", "/JavaScript", "/Launch", "/EmbeddedFile", "/RichMedia", "/SubmitForm", "/ImportData", "/XFA", "/GoToE"] as const;

/**
 * Whether bytes are a PDF a form takes, read from the bytes (never the name or the type the browser claims): it starts `%PDF-1.` or
 * `%PDF-2.`, ends with `%%EOF` (a writer may add a line after), and `text` (its bytes, and its compressed streams opened by the server)
 * names none of `PDF_ACTIVE`, in any spelling a PDF allows (`#4A` for `J`).
 */
export function pdfProblem(bytes: Uint8Array, texts: readonly string[] = []): "not_pdf" | "active" | null {
  if (bytes.length < 16 || !(ascii(bytes, 0, "%PDF-1.") || ascii(bytes, 0, "%PDF-2."))) return "not_pdf";
  const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 1024)));
  if (!tail.includes("%%EOF")) return "not_pdf";
  const all = [new TextDecoder("latin1").decode(bytes), ...texts];
  return all.some(namesActive) ? "active" : null;
}

/** Whether a PDF's text names an active part: names are read with their `#xx` escapes undone, and a name ends where a delimiter starts. */
export function namesActive(text: string): boolean {
  for (const m of text.matchAll(/\/[^\s/<>[\]()%{}]+/g)) {
    const name = m[0].replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    if ((PDF_ACTIVE as readonly string[]).includes(name)) return true;
  }
  return false;
}

/** What kind of file a form takes these bytes as, or why not: a whole WebP or JPEG within the size, or a PDF (checked further on the server). */
export function formFileKind(bytes: Uint8Array): { type: FormFileType } | { problem: "too_big" | "not_allowed" } {
  const picture = readPicture(bytes);
  if (picture) {
    if (picture.width > FORM_PICTURE_SIZE || picture.height > FORM_PICTURE_SIZE || bytes.byteLength > FORM_PICTURE_BYTES) return { problem: "too_big" };
    return { type: picture.type };
  }
  if (ascii(bytes, 0, "%PDF-")) return bytes.byteLength > FORM_PDF_BYTES ? { problem: "too_big" } : { type: "application/pdf" };
  return { problem: "not_allowed" };
}

/** Where a response's file is kept in the private `form-files` bucket: `{store or platform}/{response}/{question}.{ext}`. */
export const formFilePath = (storeId: string | null, responseId: string, question: string, type: FormFileType) =>
  `${storeId ?? "platform"}/${responseId}/${question}.${fileExtension(type)}`;

/** A size for people: `820 kB`, `2.4 MB`. */
export function fileSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
