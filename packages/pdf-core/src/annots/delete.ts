/**
 * Delete a markup. Needed by the editor's undo stack (undoing an add is a delete) and by
 * the Delete key.
 *
 * The annotation is unlinked from the page's `/Annots` and its object is marked deleted
 * in the incremental-save snapshot, so the next update section frees it rather than
 * rewriting it. Nothing else is touched: a reply or group member that pointed at it via
 * `/IRT` keeps its reference (dangling references are legal and are what Revu itself
 * leaves behind on delete — ASSUMED, not yet verified against a Revu-deleted fixture).
 */

import { PDFArray, PDFName, PDFRef } from '@cantoo/pdf-lib';
import type { Markup, RedlineDocument } from '../types.js';
import { requireMarkup } from '../document/open.js';
import { annotsArrayForWrite, markDeleted } from '../document/save.js';

/** Remove the markup with `id` from the document and return it. */
export function deleteMarkup(doc: RedlineDocument, id: string): Markup {
  const markup = requireMarkup(doc, id);
  const annots = annotsArrayForWrite(doc, markup.pageIndex);

  for (let i = annots.size() - 1; i >= 0; i -= 1) {
    const entry = annots.get(i);
    if (entry instanceof PDFRef ? entry === markup.ref : annots.lookup(i) === markup.raw) {
      annots.remove(i);
    }
  }

  // A Popup owned by this annotation goes with it, as every viewer expects.
  const popup = markup.raw.get(PDFName.of('Popup'));
  if (popup instanceof PDFRef) {
    for (let i = annots.size() - 1; i >= 0; i -= 1) {
      if (annots.get(i) === popup) annots.remove(i);
    }
    markDeleted(doc, popup);
  }

  markDeleted(doc, markup.ref);
  doc.markups.splice(doc.markups.indexOf(markup), 1);
  return markup;
}

/** True when the page's `/Annots` array no longer references anything. */
export function pageHasNoAnnots(doc: RedlineDocument, pageIndex: number): boolean {
  const annots = doc.pdfDoc.getPage(pageIndex).node.Annots();
  return !(annots instanceof PDFArray) || annots.size() === 0;
}
