import "server-only";

import { createRequire } from "node:module";

import type { renderToStaticMarkup as RenderToStaticMarkup } from "react-dom/server";

import { CONTRACT_CSS, ContractAuditView, ContractDocumentView, type ContractAudit } from "@/components/documents/contract-document-view";
import { OrderDocumentView } from "@/components/documents/order-document-view";
import { DOCUMENT_CSS } from "@/components/work/invoice-document";
import type { ContractSnapshot } from "@/lib/contract-fields";
import type { CreditNoteSnapshot } from "@/lib/credit-allocation";
import type { OrderInvoiceSnapshot } from "@/lib/invoice-snapshot";

/**
 * `react-dom/server` cannot be imported by a route's own code: Next refuses it in the server-component layer (and the layer's stub throws).
 * It is loaded here at run time from `node_modules` by Node itself, with a name the bundler cannot read, so it is the ordinary Node build
 * (with the ordinary `react` beside it). The view has no hook, so an element made by the server layer's React renders the same. The three
 * routes that render are given the packages in `outputFileTracingIncludes`.
 */
const renderer = (): typeof RenderToStaticMarkup => {
  const nodeRequire = createRequire(`${process.cwd()}/package.json`);
  const name = ["react-dom", "server"].join("/");
  return (nodeRequire(name) as { renderToStaticMarkup: typeof RenderToStaticMarkup }).renderToStaticMarkup;
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * A document as one HTML page for the PDF (D159, `docs/wave-1b-invoices.md` 4.9): the same `OrderDocumentView` the hosted and print pages
 * draw, from the snapshot alone, in a minimal shell with the document's own styles. The page has no script, no font, no picture and no
 * link to anything outside it, so the renderer can refuse every request. The only module of the unit that uses `react-dom/server`.
 */
export function documentHtml(snapshot: OrderInvoiceSnapshot | CreditNoteSnapshot): string {
  const body = renderer()(<OrderDocumentView snapshot={snapshot} />);
  return `<!doctype html><html lang="${escapeHtml(snapshot.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(snapshot.number)}</title><style>${DOCUMENT_CSS}</style></head><body>${body}</body></html>`;
}

/** A contract as one HTML page for its PDF (D695): `ContractDocumentView` from the snapshot alone, in the same closed shell as a document's. */
export function contractHtml(snapshot: ContractSnapshot): string {
  const body = renderer()(<ContractDocumentView snapshot={snapshot} />);
  return `<!doctype html><html lang="${escapeHtml(snapshot.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(snapshot.title)}</title><style>${CONTRACT_CSS}</style></head><body>${body}</body></html>`;
}

/** A contract's signing record as one HTML page for the page added to its signed PDF (D695 step 3). */
export function contractAuditHtml(audit: ContractAudit): string {
  const body = renderer()(<ContractAuditView audit={audit} />);
  return `<!doctype html><html lang="${escapeHtml(audit.language)}"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${escapeHtml(audit.title)}</title><style>${CONTRACT_CSS}</style></head><body>${body}</body></html>`;
}
