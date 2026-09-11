/**
 * Duplicate and lock.
 *
 * `duplicateMarkup` clones an annotation dictionary onto a page (the same or another)
 * under a fresh `/NM` and creation date, then offsets it. Keys that tie a markup to its
 * neighbours are not copied: `/Popup`, `/IRT`, `/RT` (a copy is not a reply), and `/P`
 * is set to the target page. Every other key — including Bluebeam's — comes along, so a
 * duplicated Revu markup keeps its custom-column data. The appearance stream object is
 * shared until an edit regenerates it, which is legal PDF.
 */

import { PDFName, PDFNumber, PDFString, type PDFDict } from '@cantoo/pdf-lib';
import type { Markup, RedlineDocument } from '../types.js';
import { generateUniqueNM } from '../ids.js';
import { lookupNumber, pdfDate } from './dict.js';
import { parseAnnotation } from './parse.js';
import { annotsArrayForWrite, markChanged } from '../document/save.js';
import { requireMarkup } from '../document/open.js';
import { moveMarkup } from './write.js';
import { computeMeasurement } from '../measure/compute.js';

const NOT_COPIED = new Set(['NM', 'Popup', 'IRT', 'RT', 'P']);

export interface DuplicateOptions {
  /** Target page; defaults to the source page. */
  pageIndex?: number;
  /** Offset applied to the copy, in points. */
  dx?: number;
  dy?: number;
  now?: Date;
  nm?: string;
}

export function duplicateMarkup(
  doc: RedlineDocument,
  id: string,
  options: DuplicateOptions = {},
): Markup {
  const source = requireMarkup(doc, id);
  const context = doc.pdfDoc.context;
  const pageIndex = options.pageIndex ?? source.pageIndex;
  const page = doc.pdfDoc.getPage(pageIndex);
  const now = options.now ?? new Date();
  const nm = options.nm ?? generateUniqueNM(doc.usedNM);
  if (options.nm) doc.usedNM.add(options.nm);

  const clone = context.obj({}) as PDFDict;
  for (const [key, value] of source.raw.entries()) {
    if (NOT_COPIED.has(key.asString().slice(1))) continue;
    clone.set(key, value);
  }
  clone.set(PDFName.of('NM'), PDFString.of(nm));
  clone.set(PDFName.of('P'), page.ref);
  clone.set(PDFName.of('CreationDate'), PDFString.of(pdfDate(now)));
  clone.set(PDFName.of('M'), PDFString.of(pdfDate(now)));
  const ref = context.register(clone);
  annotsArrayForWrite(doc, pageIndex).push(ref);

  const markup = parseAnnotation(ref, clone, pageIndex, nm);
  const scale = doc.pageScales.get(pageIndex);
  if (markup.measure && scale) {
    markup.measure.scale = scale.scale;
    markup.measure.units = scale.units;
    markup.measure.computed = computeMeasurement(markup, scale);
  }
  doc.markups.push(markup);
  if (options.dx || options.dy) moveMarkup(doc, nm, options.dx ?? 0, options.dy ?? 0, now);
  return markup;
}

/** Bit 7 of `/F`: Locked. A locked markup cannot be moved, edited or deleted in the UI. */
const LOCKED = 1 << 7;

export function setMarkupLocked(
  doc: RedlineDocument,
  id: string,
  locked: boolean,
  now: Date = new Date(),
): Markup {
  const markup = requireMarkup(doc, id);
  const flags = lookupNumber(markup.raw, 'F') ?? 4;
  const next = locked ? flags | LOCKED : flags & ~LOCKED;
  markup.raw.set(PDFName.of('F'), PDFNumber.of(next));
  markup.raw.set(PDFName.of('M'), PDFString.of(pdfDate(now)));
  markup.flags.locked = locked;
  if (markup.text) markup.text.modified = now;
  markChanged(doc, markup.ref);
  return markup;
}
