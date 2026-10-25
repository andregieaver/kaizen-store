"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import type { FieldData } from "@/lib/custom-fields";
import { productInput, type ProductInput } from "@/lib/product-input";
import { addressChangeWords, type AddressChange } from "@/lib/redirect-admin";
import { canWrite, writeRequest, type WrittenText } from "@/lib/product-writing";
import { AiError, aiFor } from "@/server/ai";
import { actionAdminLang } from "@/server/admin-request-lang";
import { type Membership } from "@/server/auth";
import { NO_ACCESS, checkAnyPermission, checkPermission, requirePermission } from "@/server/permissions";
import { catalogTag } from "@/server/catalog";
import { fieldsTag, getFieldData, getVariantFieldData } from "@/server/custom-fields";
import { refreshStoreEmbeddings } from "@/server/embeddings";
import { suggestProductText } from "@/server/product-writer";
import { addressBefore, addressChangedAfter } from "@/server/redirect-notes";
import {
  startFileUpload,
  startVideoUpload,
  type FileUpload,
  type UploadResult,
  type VideoUpload,
} from "@/server/media";
import { registerVideo, uploadToLibrary } from "@/server/media-library";
import { TERM_ORDER_MAX, createTerm, deleteTerm, setTermOrder, termProducts, termsTag, updateTerm, type TermProduct, type TermsResult } from "@/server/taxonomy";
import { storageRefusal } from "@/server/limits";
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
      /** What is entered in its custom fields (D118), as stored. */
      fieldData: FieldData;
      /** And in its variants' fields, by variant id. */
      variantFieldData: Record<string, FieldData>;
      /** The old and the new address when this save changed the handle and a redirect from the old one was left (wave 2, D168): the editor says so. */
      handleChanged?: AddressChange | null;
    }
  | { status: "error"; problems: string[] };

/** The editor's answers in the account's language (D312 A5); a refusal before a member is known in the request's. */
const wordsOf = (member: Membership) => adminText(adminLangOf(member.account.adminLocale), "product").actions;
const noAccess = async () => adminText(await actionAdminLang(), "product").actions.noAccess;

function refreshCatalogue(member: Membership) {
  updateTag(catalogTag(member.store.id));
  // A product's custom fields (D118) are read under their own tag.
  updateTag(fieldsTag(member.store.id));
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
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { status: "error", problems: [await noAccess()] };
  const w = wordsOf(member);
  if (productId !== null && !z.uuid().safeParse(productId).success) {
    return { status: "error", problems: [w.unknownProduct] };
  }
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return { status: "error", problems: [w.unreadable] };
  }
  const parsed = productInput.safeParse(json);
  if (!parsed.success) {
    return { status: "error", problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  }
  const context = await getEditorContext(member.store);
  // The address the product has before this save: a changed handle leaves a redirect (the database's trigger), which the reply names.
  const before = productId ? await addressBefore(member.store.id, { product: productId }) : null;
  // Custom fields (D118) come along in the same JSON; the server checks them against the store's own groups.
  const sent = typeof json === "object" && json !== null ? (json as { fields?: unknown; variantFields?: unknown }) : {};
  const result = await saveProduct(member.store, context, productId, parsed.data, sent.fields, sent.variantFields, member.account);
  if (!result.ok) return { status: "error", problems: result.problems };
  refreshCatalogue(member);
  const handleChanged = await addressChangedAfter(member.store.id, before).catch(() => null);
  // Search by meaning finds the product as saved, without waiting for the cron (D74).
  after(() => refreshStoreEmbeddings(member.store.id));
  const fresh = await getEditorContext(member.store);
  const product = await getProductForEdit(member.store, fresh, result.productId);
  if (!product) return { status: "error", problems: [w.notReloaded] };
  const { archived, ...input } = product;
  void archived;
  return {
    status: "saved",
    productId: result.productId,
    savedAt: new Date().toISOString(),
    product: input,
    context: fresh,
    fieldData: await getFieldData(member.store.id, "product", result.productId),
    variantFieldData: await getVariantFieldData(member.store.id, result.productId),
    handleChanged,
  };
}

/** Receives a picture already shrunk by the browser, plus its thumbnail. */
export async function uploadImageAction(storeSlug: string, formData: FormData): Promise<UploadResult> {
  // The page builder uploads its pictures here too, so the website's members may as well (and only these two areas' members).
  const member = await checkAnyPermission(storeSlug, ["products:write", "website:write"]);
  if (!member) return { ok: false, problem: await noAccess() };
  // Kept in the store's media library too (D88).
  return uploadToLibrary({ storeId: member.store.id, accountId: member.account.id }, formData);
}

export async function archiveProductAction(storeSlug: string, productId: string, archive: boolean) {
  const member = await requirePermission(storeSlug, "products:write");
  if (!z.uuid().safeParse(productId).success) return;
  await setArchived(member.store, productId, archive, member.account);
  refreshCatalogue(member);
  redirect(`/admin/${storeSlug}/products${archive ? "" : `/${productId}`}`);
}

/** The video the browser means to upload: its name, type and size, checked again by the bucket. */
const videoFile = z.object({ name: z.string().max(255).optional(), type: z.string().max(100), size: z.number().int().nonnegative(), compressed: z.boolean().optional() });

/** Starts an upload of a row's background video straight from the browser to the public bucket. */
export async function startVideoUploadAction(storeSlug: string, file: unknown): Promise<VideoUpload> {
  const member = await checkAnyPermission(storeSlug, ["products:write", "website:write"]);
  if (!member) return { ok: false, problem: NO_ACCESS };
  const { account, store } = member;
  const parsed = videoFile.safeParse(file);
  if (!parsed.success) return { ok: false, problem: "Choose a video to upload." };
  const full = await storageRefusal(store.id, parsed.data.size);
  if (full) return { ok: false, problem: full };
  const started = await startVideoUpload(store.id, parsed.data);
  // Kept in the store's media library as its upload starts (D88).
  if (started.ok) await registerVideo({ storeId: store.id, accountId: account.id }, started, parsed.data);
  return started;
}

/** Starts an upload of a download file straight from the browser to the private bucket (D24). */
export async function startFileUploadAction(storeSlug: string, fileName: string): Promise<FileUpload> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false, problem: await noAccess() };
  const name = z.string().trim().min(1).max(200).safeParse(fileName);
  if (!name.success) return { ok: false, problem: wordsOf(member).fileName };
  // A download's size is not known before it is uploaded: a store already at its storage limit adds none.
  const full = await storageRefusal(member.store.id, 1);
  if (full) return { ok: false, problem: full };
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
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  return termsChanged(member, await createTerm(member.account, productTerms(member), input));
}

/** What an edit of a category or tag answers: the list, and a sentence when its address changed and a redirect from the old one was left (wave 2, D168). */
export type TermsOutcome = TermsResult & { note?: string };

export async function updateProductTermAction(storeSlug: string, id: string, input: unknown): Promise<TermsOutcome> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown category or tag."] };
  const before = await addressBefore(member.store.id, { term: id });
  const result = termsChanged(member, await updateTerm(member.account, productTerms(member), id, input));
  if (!result.ok) return result;
  const change = await addressChangedAfter(member.store.id, before).catch(() => null);
  return change ? { ...result, note: addressChangeWords(change) } : result;
}

/** A category's or tag's own products in the owner's order (wave 6 unit A, D319), for its panel, which only those who may change the order open. */
export async function termProductsAction(storeSlug: string, termId: string): Promise<TermProduct[]> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member || !z.uuid().safeParse(termId).success) return [];
  return termProducts(member.store.id, termId);
}

/** Saves the owner's order of a category's or tag's products (D319); the catalogue is refreshed, so its page and grids follow at once. */
export async function saveTermOrderAction(storeSlug: string, termId: string, productIds: unknown): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const ids = z.array(z.uuid()).max(TERM_ORDER_MAX).safeParse(productIds);
  if (!z.uuid().safeParse(termId).success || !ids.success) return { ok: false, problems: ["Unknown category or tag."] };
  const result = await setTermOrder(member.account, member.store.id, termId, ids.data);
  if (result.ok) {
    updateTag(termsTag(productTerms(member)));
    refreshCatalogue(member);
  }
  return result;
}

export async function deleteProductTermAction(storeSlug: string, id: string): Promise<TermsResult> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown category or tag."] };
  return termsChanged(member, await deleteTerm(member.account, productTerms(member), id));
}

export type SuggestResult = { ok: true; written: WrittenText; model: string } | { ok: false; problem: string };

/**
 * An AI suggestion for the product's texts (D76), from the facts in the
 * editor. Staff edit it and copy it in; it is saved only with the product.
 */
export async function suggestTextAction(storeSlug: string, productId: string | null, request: unknown): Promise<SuggestResult> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false, problem: await noAccess() };
  const w = wordsOf(member);
  if (productId !== null && !z.uuid().safeParse(productId).success) return { ok: false, problem: w.unknownProduct };
  const parsed = writeRequest.safeParse(request);
  if (!parsed.success) return { ok: false, problem: w.textsUnreadable };
  if (!canWrite(parsed.data.kind, parsed.data.facts)) {
    return { ok: false, problem: parsed.data.kind === "improve" ? w.descriptionFirst : w.titleFirst };
  }
  const connection = await aiFor(member.store.id, { feature: "product_writer", accountId: member.account.id });
  if (!connection?.textModel) return { ok: false, problem: w.noModel };
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
      problem: error instanceof AiError ? fillWords(w.aiFailedBecause, { reason: error.message }) : w.aiFailed,
    };
  }
}
