/**
 * Hide/show and z-order (PLAN §3.11 context menu). Hidden is bit 2 of `/F`; z-order is
 * the position in the page's `/Annots` (later entries paint on top), mirrored in
 * `doc.markups` so the canvas draws in the same order.
 */

import { PDFName, PDFNumber, PDFString, type PDFObject } from '@cantoo/pdf-lib';
import type { Markup, RedlineDocument } from '../types.js';
import { requireMarkup } from '../document/open.js';
import { annotsArrayForWrite, markChanged } from '../document/save.js';
import { lookupNumber, pdfDate } from './dict.js';

const HIDDEN = 1 << 1;

export function setMarkupHidden(
  doc: RedlineDocument,
  id: string,
  hidden: boolean,
  now: Date = new Date(),
): Markup {
  const markup = requireMarkup(doc, id);
  const flags = lookupNumber(markup.raw, 'F') ?? 4;
  markup.raw.set(PDFName.of('F'), PDFNumber.of(hidden ? flags | HIDDEN : flags & ~HIDDEN));
  markup.raw.set(PDFName.of('M'), PDFString.of(pdfDate(now)));
  markup.flags.hidden = hidden;
  if (markup.text) markup.text.modified = now;
  markChanged(doc, markup.ref);
  return markup;
}

/** Where a markup sits: in its page's `/Annots` and in `doc.markups`. */
export interface MarkupOrder {
  annotsIndex: number;
  listIndex: number;
}

export function markupOrder(doc: RedlineDocument, id: string): MarkupOrder {
  const markup = requireMarkup(doc, id);
  const annots = doc.pdfDoc.getPage(markup.pageIndex).node.Annots();
  let annotsIndex = -1;
  if (annots) {
    for (let i = 0; i < annots.size(); i += 1) {
      const e = annots.get(i);
      if (e === markup.ref || e?.toString() === markup.ref.toString()) {
        annotsIndex = i;
        break;
      }
    }
  }
  return { annotsIndex, listIndex: doc.markups.indexOf(markup) };
}

/** Put a markup at the given positions (clamped); used by undo. */
export function setMarkupOrder(doc: RedlineDocument, id: string, order: MarkupOrder): Markup {
  const markup = requireMarkup(doc, id);
  const annots = annotsArrayForWrite(doc, markup.pageIndex);
  const entries: PDFObject[] = [];
  for (let i = 0; i < annots.size(); i += 1) entries.push(annots.get(i));
  const at = entries.findIndex((e) => e === markup.ref || e?.toString() === markup.ref.toString());
  if (at >= 0) {
    entries.splice(at, 1);
    const target = Math.max(0, Math.min(entries.length, order.annotsIndex));
    entries.splice(target, 0, markup.ref);
    while (annots.size() > 0) annots.remove(annots.size() - 1);
    for (const e of entries) annots.push(e);
  }
  const index = doc.markups.indexOf(markup);
  if (index >= 0) {
    doc.markups.splice(index, 1);
    const target = Math.max(0, Math.min(doc.markups.length, order.listIndex));
    doc.markups.splice(target, 0, markup);
  }
  return markup;
}

/** Move a markup to the top (`front`) or bottom (`back`) of its page's paint order. Returns where it was. */
export function reorderMarkup(
  doc: RedlineDocument,
  id: string,
  where: 'front' | 'back',
): MarkupOrder {
  const previous = markupOrder(doc, id);
  const markup = requireMarkup(doc, id);
  const annots = annotsArrayForWrite(doc, markup.pageIndex);
  setMarkupOrder(doc, id, {
    annotsIndex: where === 'front' ? annots.size() : 0,
    listIndex: where === 'front' ? doc.markups.length : 0,
  });
  return previous;
}
