import type { FormFileType } from "./form-files";

/**
 * How a form's file reaches the owner's staff (D738 F6b): always as a download (`attachment`, never shown on an admin page), its type as
 * read from its bytes, nothing run (`default-src 'none'`, `nosniff`), never cached.
 */
export function fileDownload(file: { bytes: Uint8Array; name: string; type: FormFileType }): Response {
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  // A copy of its own: a plain ArrayBuffer behind it, as a response's body takes.
  return new Response(file.bytes.slice(), {
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

export const QUESTION_KEY = /^[A-Za-z0-9_-]{1,64}$/;
