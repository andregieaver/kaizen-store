import type { FieldFile } from "@/lib/custom-fields";
import { createClient } from "@/lib/supabase/client";

import type { FieldFileUploader } from "./fields-form-helpers";

/** Starts a file's upload for a custom field: a signed upload to the public bucket and the address it will have. */
export type StartFieldFile = (file: {
  name: string;
  type: string;
  size: number;
}) => Promise<
  { ok: true; path: string; token: string; bucket: string; url: string; name: string } | { ok: false; problem: string }
>;

/**
 * A `FieldFileUploader` (D118) made from a host's action that starts the upload:
 * the file goes straight from the browser to storage (it may be far larger than
 * a server request allows), as a background video does.
 */
export function fieldFileUploader(start: StartFieldFile): FieldFileUploader {
  return async (file: File): Promise<FieldFile | { problem: string }> => {
    try {
      const started = await start({ name: file.name, type: file.type, size: file.size });
      if (!started.ok) return { problem: started.problem };
      const stored = await createClient()
        .storage.from(started.bucket)
        .uploadToSignedUrl(started.path, started.token, file, { contentType: file.type });
      if (stored.error) return { problem: `${file.name} could not be uploaded. Try again.` };
      return { url: started.url, name: started.name, size: file.size, contentType: file.type };
    } catch {
      return { problem: `${file.name} could not be uploaded. Try again.` };
    }
  };
}
