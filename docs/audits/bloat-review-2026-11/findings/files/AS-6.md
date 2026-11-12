# AS-6 ✓ The PDF routes carry all of react-dom (8.1 MB) to use two server builds of it

Files that ship or are stored (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P3. **Effort:** S. **Confidence:** medium. **Step:** tolerated.
- **Second check:** confirmed.
- **Where:** `next.config.ts:23`, `src/server/document-html.tsx:18`, `src/server/document-readers.test.ts:1`, `node_modules/.pnpm/react-dom@19.3.1_react@19.3.1/node_modules/react-dom/server.node.js`
- **Evidence:** DOCUMENT_PDF_FILES traces react-dom/** whole (next.config.ts:23). Re-run: four traces carry it, 8.07 MB each; the trace of /api/cron/document-pdfs is 106.8 MB. document-html.tsx loads react-dom/server through Node at run time (lines 18-22). In production server.node.js requires react-dom-server-legacy.node.production.js (0.26 MB) and react-dom-server.node.production.js (0.30 MB); both require react and react-dom, whose index.js requires cjs/react-dom.production.js (7 KB). The rest of the folder is development, profiling, browser, edge and bun builds.
- **Cost today:** About 7.5 MB on each of four traces of 106.8 to 139.8 MB. No effect on anything a person feels was measured. Paid by: The server (the size of the PDF functions).
- **Saving:** About 7.5 MB per PDF trace (estimate from file sizes), 5 to 7% of those traces.
- **Risk:** A missed file breaks invoice PDFs in production only, and no local test can see it.

## The fix

1. next.config.ts:23: replace the react-dom/** glob with two: .../react-dom/{package.json,index.js,server.js,server.node.js} and .../react-dom/cjs/{react-dom.production,react-dom-server.node.production,react-dom-server-legacy.node.production}.js.
2. src/lib/chromium-trace.test.ts (or src/server/document-readers.test.ts): expect next.config.ts to name those files, with why.
3. Before production: download one invoice PDF from a preview deployment of the commit, through the hosted page's route and the admin's, because a missing file shows only on Vercel.

**Done when:** scripts/trace-sizes.mjs shows react-dom at about 0.6 MB in its four traces (8.07 MB today), and an invoice PDF downloads from a preview deployment.

**Tests and rules that hold today's behaviour, and change with it:**

- next.config.ts:19-20 (the comment on why react-dom is traced).
- e2e/invoices.spec.ts:117 downloads F-1.pdf on the built app; it runs from node_modules whole, so it cannot catch a missing traced file.
- src/server/document-readers.test.ts holds who may use invoice-pdf.ts.

**Comes after:** AS-3 (to read the number)

**Notes:** P3: the gain is a few percent of the four largest traces and nothing a person feels; the risk is invoices failing in production. Do it only if a function nears Vercel's size limit.
