/**
 * Delete and restore markups.
 *
 * pdf-lib's incremental snapshot cannot un-delete an object, and the editor needs undo, so
 * `deleteMarkup` only UNLINKS the annotation from the page's `/Annots` and parks it in
 * `doc.trash`. `restoreMarkup` re-links it at its old position. Nothing in the file changes
 * until a finalising save (`saveIncremental(doc, { finalize: true })`), which frees
 * file-born objects and drops session-born ones. Autosave never finalises.
 *
 * A reply or group member that pointed at a deleted markup via `/IRT` keeps its reference
 * (dangling references are legal and are what Revu itself leaves behind — ASSUMED, not
 * yet verified against a Revu-deleted fixture).
 */

import { PDFArray, PDFName, PDFRef } from '@cantoo/pdf-lib';
import type { DeletedMarkup, Markup, RedlineDocument } from '../types.js';
import { requireMarkup } from '../document/open.js';
import { annotsArrayForWrite } from '../document/save.js';

function indexOfRef(annots: PDFArray, ref: PDFRef, dict: Markup['raw']): number {
  for (let i = 0; i < annots.size(); i += 1) {
    const entry = annots.get(i);
    if (entry instanceof PDFRef ? entry === ref : annots.lookup(i) === dict) return i;
  }
  return -1;
}

/** Unlink the markup with `id` from the document (restorable) and return it. */
export function deleteMarkup(doc: RedlineDocument, id: string): Markup {
  const markup = requireMarkup(doc, id);
  const annots = annotsArrayForWrite(doc, markup.pageIndex);

  const annotsIndex = indexOfRef(annots, markup.ref, markup.raw);
  if (annotsIndex >= 0) annots.remove(annotsIndex);

  // A Popup owned by this annotation goes with it, as every viewer expects.
  const popup = markup.raw.get(PDFName.of('Popup'));
  let popupRef: PDFRef | undefined;
  if (popup instanceof PDFRef) {
    popupRef = popup;
    for (let i = annots.size() - 1; i >= 0; i -= 1) {
      if (annots.get(i) === popup) annots.remove(i);
    }
  }

  const listIndex = doc.markups.indexOf(markup);
  doc.markups.splice(listIndex, 1);
  doc.trash.push({
    markup,
    annotsIndex: annotsIndex < 0 ? annots.size() : annotsIndex,
    listIndex,
    ...(popupRef && { popup: popupRef }),
  });
  return markup;
}

/** Re-link a deleted markup (undo of delete). Returns undefined when it is not in the trash. */
export function restoreMarkup(doc: RedlineDocument, id: string): Markup | undefined {
  const at = doc.trash.findIndex((t) => t.markup.id === id);
  if (at < 0) return undefined;
  const [entry] = doc.trash.splice(at, 1) as [DeletedMarkup];
  const { markup } = entry;
  const annots = annotsArrayForWrite(doc, markup.pageIndex);
  const index = Math.min(entry.annotsIndex, annots.size());
  annots.insert(index, markup.ref);
  if (entry.popup) annots.insert(index + 1, entry.popup);
  doc.markups.splice(Math.min(entry.listIndex, doc.markups.length), 0, markup);
  return markup;
}

/** True when the page's `/Annots` array no longer references anything. */
export function pageHasNoAnnots(doc: RedlineDocument, pageIndex: number): boolean {
  const annots = doc.pdfDoc.getPage(pageIndex).node.Annots();
  return !(annots instanceof PDFArray) || annots.size() === 0;
}
