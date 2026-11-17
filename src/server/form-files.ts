import "server-only";

import { inflateSync } from "node:zlib";

import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { publicEnv } from "@/lib/env";
import { FORM_FILES_BYTES, formFileKind, formFilePath, pdfProblem, safeFileName, type FormFile, type FormFileType } from "@/lib/form-files";
import { supabaseKeyKind } from "@/lib/supabase-key";

import { log } from "./log";
import { owned } from "./owned";
import { col, typedRows } from "./typed-rows";

/**
 * Files sent with forms (D738 F6b, `docs/forms.md` 15.2): the private bucket `form-files`, written, read and emptied only here with the secret
 * key. A response's files are `{owner}/{response}/{question}.{ext}` (`formFilePath()`), listed in its row's `files`; a file whose response is
 * gone (deleted, past its months, erased, its form or store gone, or a sending that failed after its upload) is removed by the daily
 * `pruneFormFiles()`. Nothing here is ever served from a public address: the owner's staff download a file through the admin.
 */

export const FORM_FILES_BUCKET = "form-files";

export type FormFileStorage = {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<boolean>;
  download(path: string): Promise<Uint8Array | null>;
  remove(paths: string[]): Promise<boolean>;
  /** Up to `limit` names in a folder (the root lists its owners' folders, an owner's its responses'), from `offset`. */
  list(folder: string, limit: number, offset: number): Promise<{ name: string; createdAt: string | null }[] | null>;
};

let stand: FormFileStorage | null | undefined;
/** Tests only: a stand-in for the bucket (an in-memory one), or `undefined` for the real one again. */
export function standInFormFiles(storage: FormFileStorage | null | undefined): void {
  stand = storage;
}

/** The bucket behind the secret key, or null when this server has none (a form with a file question then takes no files). */
export function formFileStorage(): FormFileStorage | null {
  if (stand !== undefined) return stand;
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key || supabaseKeyKind(key) === "publishable") return null;
  let url: string;
  try {
    url = publicEnv().NEXT_PUBLIC_SUPABASE_URL;
  } catch {
    return null;
  }
  const bucket = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(FORM_FILES_BUCKET);
  return {
    async upload(path, bytes, contentType) {
      const { error } = await bucket.upload(path, bytes, { contentType, cacheControl: "0", upsert: false });
      if (error) log("error", "forms.file_store_failed", {}, error);
      return !error;
    },
    async download(path) {
      const { data, error } = await bucket.download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(paths) {
      if (paths.length === 0) return true;
      const { error } = await bucket.remove(paths);
      if (error) log("error", "forms.files_remove_failed", {}, error);
      return !error;
    },
    async list(folder, limit, offset) {
      const { data, error } = await bucket.list(folder, { limit, offset, sortBy: { column: "name", order: "asc" } });
      if (error || !data) return null;
      return data.map((f) => ({ name: f.name, createdAt: (f.created_at as string | null) ?? null }));
    },
  };
}

/** A file as a visitor sent it: the bytes and the name their device gave. */
export type SentFile = { name: string; bytes: Uint8Array };
/** A file the form takes, ready to store. */
export type TakenFile = { question: string; name: string; type: FormFileType; bytes: Uint8Array };
export type FileProblem = "too_big" | "not_allowed";

/** At most this much of a PDF's compressed streams is opened to look for what runs (a stream that opens to more is a reason to refuse). */
const INFLATED_MAX = 20_000_000;

/** The text of a PDF's compressed streams, opened as far as `INFLATED_MAX`; null when they open to more than that. */
export function pdfStreams(bytes: Uint8Array): string[] | null {
  const text = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  let total = 0;
  for (const m of text.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) break;
    const raw = Buffer.from(text.slice(start, end), "latin1");
    try {
      const opened = inflateSync(raw, { maxOutputLength: INFLATED_MAX - total });
      total += opened.length;
      out.push(opened.toString("latin1"));
    } catch (error) {
      // A stream that is not compressed (or not with Flate) is read as it is, with the file; one that opens to too much is refused.
      if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") return null;
    }
  }
  return out;
}

/** One sent file checked from its bytes: a picture (the browser drew it again) or a PDF with nothing in it that runs. */
export function takeFile(question: string, sent: SentFile): TakenFile | FileProblem {
  const kind = formFileKind(sent.bytes);
  if ("problem" in kind) return kind.problem;
  if (kind.type === "application/pdf") {
    const streams = pdfStreams(sent.bytes);
    if (streams === null || pdfProblem(sent.bytes, streams) !== null) return "not_allowed";
  }
  return { question, name: safeFileName(sent.name, kind.type), type: kind.type, bytes: sent.bytes };
}

/** The files a sending carries, each by its question: too many bytes together is refused before any is read further. */
export function totalTooBig(files: readonly SentFile[]): boolean {
  return files.reduce((sum, f) => sum + f.bytes.byteLength, 0) > FORM_FILES_BYTES;
}

/**
 * Stores a response's files before its row is written (so the row never lists a file that is not there). False when one could not be stored:
 * the visitor is told it failed, and what was stored is left to the sweep.
 */
export async function storeFiles(storeId: string | null, responseId: string, files: readonly TakenFile[], storage = formFileStorage()): Promise<FormFile[] | null> {
  if (files.length === 0) return [];
  if (!storage) return null;
  const kept: FormFile[] = [];
  for (const f of files) {
    const path = formFilePath(storeId, responseId, f.question, f.type);
    if (!(await storage.upload(path, f.bytes, f.type))) return null;
    kept.push({ question: f.question, name: f.name, type: f.type, bytes: f.bytes.byteLength, path });
  }
  return kept;
}

const fileRow = z.object({ files: z.array(z.object({ question: z.string(), name: z.string(), type: z.enum(["image/webp", "image/jpeg", "application/pdf"]), bytes: z.number(), path: z.string() })) });

/** A response's file for the owner's staff: only of that owner's form and response. Null: there is none. */
export async function fileForStaff(
  storeId: string | null,
  formId: string,
  responseId: string,
  question: string,
  storage = formFileStorage(),
): Promise<{ bytes: Uint8Array; name: string; type: FormFileType } | null> {
  if (!storage) return null;
  const [row] = await typedRows(fileRow, sql`select files from commerce.form_responses where ${owned(storeId)} and form_id = ${formId}::uuid and id = ${responseId}::uuid`);
  const file = row?.files.find((f) => f.question === question);
  if (!file || !file.path.startsWith(`${storeId ?? "platform"}/${responseId}/`)) return null;
  const bytes = await storage.download(file.path).catch(() => null);
  return bytes ? { bytes, name: file.name, type: file.type } : null;
}

const SWEEP_AFTER_MS = 60 * 60 * 1000;
const PAGE = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The daily sweep: every response folder in the bucket whose response has no row, and that is older than an hour (a sending may still be
 * writing it), is emptied, owner folder by owner folder, until `deadline`.
 */
export async function pruneFormFiles({
  deadline = Date.now() + 60_000,
  storage = formFileStorage(),
  now = Date.now(),
}: { deadline?: number; storage?: FormFileStorage | null; now?: number } = {}): Promise<{ removed: number }> {
  if (!storage) return { removed: 0 };
  let removed = 0;
  const owners: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await storage.list("", PAGE, offset);
    if (!page) return { removed };
    owners.push(...page.map((f) => f.name).filter((n) => n === "platform" || UUID.test(n)));
    if (page.length < PAGE) break;
  }
  for (const owner of owners) {
    if (Date.now() > deadline) break;
    const folders: string[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await storage.list(owner, PAGE, offset);
      if (!page) break;
      folders.push(...page.map((f) => f.name).filter((n) => UUID.test(n)));
      if (page.length < PAGE) break;
    }
    if (folders.length === 0) continue;
    const rows = await typedRows(
      z.object({ id: col.uuid }),
      sql`select id from commerce.form_responses where id in (select jsonb_array_elements_text(${JSON.stringify(folders)}::jsonb)::uuid)`,
    );
    const kept = new Set(rows.map((r) => r.id));
    for (const folder of folders.filter((f) => !kept.has(f))) {
      if (Date.now() > deadline) break;
      const files = await storage.list(`${owner}/${folder}`, 10, 0);
      if (!files) continue;
      const old = files.filter((f) => f.createdAt === null || now - new Date(f.createdAt).getTime() > SWEEP_AFTER_MS);
      if (old.length > 0 && (await storage.remove(old.map((f) => `${owner}/${folder}/${f.name}`)))) removed += old.length;
    }
  }
  return { removed };
}
