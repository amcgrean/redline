/**
 * Page-structure operations (PLAN §3.9, Phase 4): rotate, delete, move, insert blank,
 * insert from another PDF, extract, merge. These change the page tree, so they are
 * followed by a FULL save (`saveFull`), never an incremental one (CLAUDE.md #5).
 *
 * The markup model on a `RedlineDocument` describes page indices as they were at open
 * time. After any operation here the caller must rebuild it: `saveFull` then
 * `openDocument` on the result. The web app does exactly that and swaps the session's
 * document, which also refreshes pdf.js.
 *
 * What survives a full rewrite: every object pdf-lib parsed is re-serialised with its
 * keys intact (Bluebeam's `/BSI*`, `/RC`, `/Measure`, custom columns, spaces). What does
 * not: the file's incremental-update history (flattened into one xref), and objects that
 * nothing references any more. Bookmarks (`/Outlines`) are kept on rotate/delete/move
 * within a document; `copyPages` does not carry the source's outlines, so merge and
 * insert-from drop the incoming file's bookmarks (see ADR 0004).
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  degrees,
  type PDFPage,
} from '@cantoo/pdf-lib';
import type { RedlineDocument } from '../types.js';

function normalizeIndices(doc: RedlineDocument, indices: readonly number[]): number[] {
  const count = doc.pdfDoc.getPageCount();
  const unique = [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < count);
  return unique.sort((a, b) => a - b);
}

/** Rotate pages by a multiple of 90° (clockwise positive), on top of their current `/Rotate`. */
export function rotatePages(
  doc: RedlineDocument,
  indices: readonly number[],
  delta: 90 | 180 | 270 | -90,
): void {
  for (const i of normalizeIndices(doc, indices)) {
    const page = doc.pdfDoc.getPage(i);
    const current = page.getRotation().angle;
    const next = (((current + delta) % 360) + 360) % 360;
    page.setRotation(degrees(next));
    const size = doc.pageSizes[i];
    if (size) size.rotation = next;
  }
}

/** Delete pages. The last page cannot be deleted (a PDF needs at least one). */
export function deletePages(doc: RedlineDocument, indices: readonly number[]): number {
  const list = normalizeIndices(doc, indices);
  const count = doc.pdfDoc.getPageCount();
  if (list.length >= count) throw new Error('A document must keep at least one page');
  for (const i of [...list].reverse()) {
    // Drop the page's annotations too, so the rewrite does not carry orphaned objects.
    const page = doc.pdfDoc.getPage(i);
    const annots = page.node.Annots();
    if (annots instanceof PDFArray) {
      for (let k = 0; k < annots.size(); k += 1) {
        const ref = annots.get(k);
        if (!(ref instanceof PDFRef)) continue;
        const dict = doc.pdfDoc.context.lookup(ref);
        if (dict instanceof PDFDict) {
          const popup = dict.get(PDFName.of('Popup'));
          if (popup instanceof PDFRef) doc.pdfDoc.context.delete(popup);
        }
        doc.pdfDoc.context.delete(ref);
      }
    }
    doc.pdfDoc.removePage(i);
  }
  return list.length;
}

/**
 * Move pages so the first moved page lands at `target` (an index in the document as it
 * is before the move, 0..pageCount). Relative order among moved pages is kept.
 */
export function movePages(doc: RedlineDocument, indices: readonly number[], target: number): void {
  const list = normalizeIndices(doc, indices);
  if (list.length === 0) return;
  const pdf = doc.pdfDoc;
  const count = pdf.getPageCount();
  const to = Math.max(0, Math.min(count, target));
  const pages: PDFPage[] = list.map((i) => pdf.getPage(i));
  // Where the block goes once the moved pages are taken out.
  const before = list.filter((i) => i < to).length;
  const insertAt = to - before;
  // `removePage` deletes the page object from the context; put it back under the same
  // ref before re-inserting, or the moved page would be a dangling reference on save.
  for (const i of [...list].reverse()) pdf.removePage(i);
  pages.forEach((page, k) => {
    pdf.context.assign(page.ref, page.node);
    pdf.insertPage(insertAt + k, page);
  });
}

/** Insert a blank page at `index` with the given size in points (defaults to ARCH D landscape). */
export function insertBlankPage(
  doc: RedlineDocument,
  index: number,
  size: [number, number] = [2592, 1728],
): void {
  const count = doc.pdfDoc.getPageCount();
  doc.pdfDoc.insertPage(Math.max(0, Math.min(count, index)), size);
}

/** Insert pages copied from another PDF at `index`. `indices` defaults to every page. */
export async function insertPagesFrom(
  doc: RedlineDocument,
  sourceBytes: Uint8Array,
  index: number,
  indices?: readonly number[],
): Promise<number> {
  const source = await PDFDocument.load(sourceBytes, {
    updateMetadata: false,
    ignoreEncryption: true,
  });
  const which = indices ? [...indices] : source.getPageIndices();
  const copied = await doc.pdfDoc.copyPages(source, which);
  const count = doc.pdfDoc.getPageCount();
  const at = Math.max(0, Math.min(count, index));
  copied.forEach((page, k) => doc.pdfDoc.insertPage(at + k, page));
  return copied.length;
}

/** A new PDF containing copies of the given pages, in the given order. */
export async function extractPages(
  doc: RedlineDocument,
  indices: readonly number[],
): Promise<Uint8Array> {
  const out = await PDFDocument.create({ updateMetadata: false });
  const copied = await out.copyPages(doc.pdfDoc, [...indices]);
  for (const page of copied) out.addPage(page);
  return out.save({ useObjectStreams: false });
}

/** Concatenate several PDFs into one. Markups come along; bookmarks do not (ADR 0004). */
export async function mergeDocuments(sources: readonly Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const bytes of sources) {
    const source = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    const copied = await out.copyPages(source, source.getPageIndices());
    for (const page of copied) out.addPage(page);
  }
  return out.save({ useObjectStreams: false });
}

/**
 * Full rewrite of the document. Pending deletions (`doc.trash`) are applied first so
 * a trashed markup's objects are not resurrected by the rewrite. Object streams are
 * off (plain objects, like Revu's own output) and form-field appearances untouched.
 */
export async function saveFull(doc: RedlineDocument): Promise<Uint8Array> {
  const context = doc.pdfDoc.context;
  for (const entry of doc.trash) {
    context.delete(entry.markup.ref);
    if (entry.popup) context.delete(entry.popup);
  }
  doc.trash = [];
  // The baseline snapshot is meaningless after a rewrite; a caller that keeps using
  // this RedlineDocument must re-open it anyway (see module comment).
  return doc.pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/** The `/Rotate` of a page as a normalised 0/90/180/270. */
export function pageRotation(doc: RedlineDocument, index: number): number {
  const angle = doc.pdfDoc.getPage(index).getRotation().angle;
  return ((angle % 360) + 360) % 360;
}
