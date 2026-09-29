"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { productInput, type ProductInput } from "@/lib/product-input";
import { canWrite, writeRequest, type WrittenText } from "@/lib/product-writing";
import { AiError, aiFor } from "@/server/ai";
import { requireMember, type Membership } from "@/server/auth";
import { catalogTag } from "@/server/catalog";
import { refreshStoreEmbeddings } from "@/server/embeddings";
import { suggestProductText } from "@/server/product-writer";
import {
  startFileUpload,
  startVideoUpload,
  type FileUpload,
  type UploadResult,
  type VideoUpload,
} from "@/server/media";
import { registerVideo, uploadToLibrary } from "@/server/media-library";
import { createTerm, deleteTerm, termsTag, updateTerm, type TermsResult } from "@/server/taxonomy";
import {
  getEditorContext,
  getProductForEdit,
  saveProduct,
  setArchived,
  type EditorContext,
} from "@/server/products";

export type SaveState =
  | { status: "idle" }
  | {
      status: "saved";
      productId: string;
      savedAt: string;
      /** The product as stored, with ids for new variants and contacts. */
      product: ProductInput;
      context: EditorContext;
    }
  | { status: "error"; problems: string[] };

function refreshCatalogue(member: Membership) {
  updateTag(catalogTag(member.store.id));
}

/**
 * Saves the editor's JSON payload. The whole product is checked on the
 * server again; nothing the browser sends is trusted.
 */
export async function saveProductAction(
  storeSlug: string,
  productId: string | null,
  payload: string,
): Promise<SaveState> {
  const member = await requireMember(storeSlug);
  if (productId !== null && !z.uuid().safeParse(productId).success) {
    return { status: "error", problems: ["Unknown product."] };
  }
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return { status: "error", problems: ["The form could not be read. Reload the page and try again."] };
  }
  const parsed = productInput.safeParse(json);
  if (!parsed.success) {
    return { status: "error", problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  }
  const context = await getEditorContext(member.store);
  const result = await saveProduct(member.store, context, productId, parsed.data);
  if (!result.ok) return { status: "error", problems: result.problems };
  refreshCatalogue(member);
  // Search by meaning finds the product as saved, without waiting for the cron (D74).
  after(() => refreshStoreEmbeddings(member.store.id));
  const fresh = await getEditorContext(member.store);
  const product = await getProductForEdit(member.store, fresh, result.productId);
  if (!product) return { status: "error", problems: ["The product was saved but could not be reloaded."] };
  const { archived, ...input } = product;
  void archived;
  return {
    status: "saved",
    productId: result.productId,
    savedAt: new Date().toISOString(),
    product: input,
    context: fresh,
  };
}

/** Receives a picture already shrunk by the browser, plus its thumbnail. */
export async function uploadImageAction(storeSlug: string, formData: FormData): Promise<UploadResult> {
  const { account, store } = await requireMember(storeSlug);
  // Kept in the store's media library too (D88).
  return uploadToLibrary({ storeId: store.id, accountId: account.id }, formData);
}

export async function archiveProductAction(storeSlug: string, productId: string, archive: boolean) {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(productId).success) return;
  await setArchived(member.store, productId, archive);
  refreshCatalogue(member);
  redirect(`/admin/${storeSlug}/products${archive ? "" : `/${productId}`}`);
}

/** The video the browser means to upload: its name, type and size, checked again by the bucket. */
const videoFile = z.object({ name: z.string().max(255).optional(), type: z.string().max(100), size: z.number().int().nonnegative() });

/** Starts an upload of a row's background video straight from the browser to the public bucket. */
export async function startVideoUploadAction(storeSlug: string, file: unknown): Promise<VideoUpload> {
  const { account, store } = await requireMember(storeSlug);
  const parsed = videoFile.safeParse(file);
  if (!parsed.success) return { ok: false, problem: "Choose a video to upload." };
  const started = await startVideoUpload(store.id, parsed.data);
  // Kept in the store's media library as its upload starts (D88).
  if (started.ok) await registerVideo({ storeId: store.id, accountId: account.id }, started, parsed.data);
  return started;
}

/** Starts an upload of a download file straight from the browser to the private bucket (D24). */
export async function startFileUploadAction(storeSlug: string, fileName: string): Promise<FileUpload> {
  const member = await requireMember(storeSlug);
  const name = z.string().trim().min(1).max(200).safeParse(fileName);
  if (!name.success) return { ok: false, problem: "The file needs a name." };
  return startFileUpload(member.store.id, name.data);
}

// ---------------------------------------------------------------------------
// The store's product categories and tags (D50)
// ---------------------------------------------------------------------------

const productTerms = (member: Membership) => ({ storeId: member.store.id, contentType: "product" }) as const;

function termsChanged(member: Membership, result: TermsResult): TermsResult {
  if (result.ok) {
    updateTag(termsTag(productTerms(member)));
    refreshCatalogue(member);
  }
  return result;
}

export async function createProductTermAction(storeSlug: string, input: unknown): Promise<TermsResult> {
  const member = await requireMember(storeSlug);
  return termsChanged(member, await createTerm(member.account, productTerms(member), input));
}

export async function updateProductTermAction(storeSlug: string, id: string, input: unknown): Promise<TermsResult> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown category or tag."] };
  return termsChanged(member, await updateTerm(member.account, productTerms(member), id, input));
}

export async function deleteProductTermAction(storeSlug: string, id: string): Promise<TermsResult> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown category or tag."] };
  return termsChanged(member, await deleteTerm(member.account, productTerms(member), id));
}

export type SuggestResult = { ok: true; written: WrittenText; model: string } | { ok: false; problem: string };

/**
 * An AI suggestion for the product's texts (D76), from the facts in the
 * editor. Staff edit it and copy it in; it is saved only with the product.
 */
export async function suggestTextAction(storeSlug: string, productId: string | null, request: unknown): Promise<SuggestResult> {
  const member = await requireMember(storeSlug);
  if (productId !== null && !z.uuid().safeParse(productId).success) return { ok: false, problem: "Unknown product." };
  const parsed = writeRequest.safeParse(request);
  if (!parsed.success) return { ok: false, problem: "The texts could not be read. Reload the page and try again." };
  if (!canWrite(parsed.data.kind, parsed.data.facts)) {
    return { ok: false, problem: parsed.data.kind === "improve" ? "Write a description first." : "Give the product a title first." };
  }
  const connection = await aiFor(member.store.id, { feature: "product_writer", accountId: member.account.id });
  if (!connection?.textModel) return { ok: false, problem: "The store has no AI text model. Choose one under Settings → AI." };
  try {
    const { written, model } = await suggestProductText(
      connection,
      { accountId: member.account.id, storeId: member.store.id, productId },
      parsed.data,
    );
    return { ok: true, written, model };
  } catch (error) {
    return {
      ok: false,
      problem: error instanceof AiError ? `The AI could not write it: ${error.message}` : "The AI could not write it. Try again.",
    };
  }
}
