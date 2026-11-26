/** Test support for recordings (D656, and the admin's own, D895 phase 3b): their files in memory. */

/** Storage in memory, modelled on the review pictures' tests: a path written once, listed per recording folder. */
export function memoryFiles(options: { fail?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async upload(path: string, bytes: Uint8Array) {
      if (options.fail) return "failed" as const;
      if (files.has(path)) return "exists" as const;
      files.set(path, bytes);
      return "ok" as const;
    },
    async download(path: string) {
      return files.get(path) ?? null;
    },
    async remove(paths: string[]) {
      for (const p of paths) files.delete(p);
      return true;
    },
    async list(store: string, id: string) {
      return [...files.keys()].filter((p) => p.startsWith(`${store}/${id}/`));
    },
  };
}
