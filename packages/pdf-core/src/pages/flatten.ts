/**
 * Flatten (PLAN §3.9): bake markups into page content using the SAME appearance
 * streams the viewers already draw, then drop the annotations. ISO 32000-1 §12.5.5:
 * the form's `/BBox` transformed by its `/Matrix` is fitted to `/Rect`; that fit is the
 * `cm` we emit before `Do`. The `/AP` stream object becomes a page XObject resource, so
 * nothing is re-rendered or rasterised.
 *
 * Page content changes, so a flatten is followed by `saveFull`, never an incremental
 * save (ADR 0004). Hidden and NoView annotations are removed without drawing; Popups
 * go with their parents.
 */

import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFPage,
} from '@cantoo/pdf-lib';
import type { RedlineDocument } from '../types.js';
import { lookupNumber, lookupText } from '../annots/dict.js';

const FLAG_HIDDEN = 1 << 1;
const FLAG_NOVIEW = 1 << 5;

export interface FlattenOptions {
  /** Page indices; default every page. */
  pages?: readonly number[];
  /** Only these markups (by `/NM`); default every annotation on the pages. */
  ids?: readonly string[];
}

function numbers(arr: PDFArray | undefined, count: number): number[] | undefined {
  if (!arr || arr.size() < count) return undefined;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const n = arr.lookup(i);
    if (!(n instanceof PDFNumber)) return undefined;
    out.push(n.asNumber());
  }
  return out;
}

/** `/AP /N`, following `/AS` into an appearance sub-dictionary when present. */
function normalAppearance(dict: PDFDict): { ref: PDFRef; stream: PDFStream } | undefined {
  const ap = dict.lookup(PDFName.of('AP'));
  if (!(ap instanceof PDFDict)) return undefined;
  const nRaw = ap.get(PDFName.of('N'));
  const n = ap.lookup(PDFName.of('N'));
  if (n instanceof PDFStream && nRaw instanceof PDFRef) return { ref: nRaw, stream: n };
  if (n instanceof PDFDict) {
    const as = dict.lookup(PDFName.of('AS'));
    const key = as instanceof PDFName ? as : n.keys()[0];
    if (!key) return undefined;
    const stateRaw = n.get(key);
    const state = n.lookup(key);
    if (state instanceof PDFStream && stateRaw instanceof PDFRef) {
      return { ref: stateRaw, stream: state };
    }
  }
  return undefined;
}

/** The `cm` that maps the form (BBox × Matrix) onto `rect` (ISO 32000-1 12.5.5 algorithm). */
export function appearanceMatrix(
  bbox: [number, number, number, number],
  matrix: [number, number, number, number, number, number],
  rect: [number, number, number, number],
): [number, number, number, number, number, number] {
  const [a, b, c, d, e, f] = matrix;
  const corners = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[2], bbox[3]],
    [bbox[0], bbox[3]],
  ].map(([x, y]) => [a * x! + c * y! + e, b * x! + d * y! + f]);
  const xs = corners.map((p) => p[0]!);
  const ys = corners.map((p) => p[1]!);
  const tx0 = Math.min(...xs);
  const tx1 = Math.max(...xs);
  const ty0 = Math.min(...ys);
  const ty1 = Math.max(...ys);
  const rx0 = Math.min(rect[0], rect[2]);
  const rx1 = Math.max(rect[0], rect[2]);
  const ry0 = Math.min(rect[1], rect[3]);
  const ry1 = Math.max(rect[1], rect[3]);
  const sx = tx1 - tx0 > 1e-9 ? (rx1 - rx0) / (tx1 - tx0) : 1;
  const sy = ty1 - ty0 > 1e-9 ? (ry1 - ry0) / (ty1 - ty0) : 1;
  return [sx, 0, 0, sy, rx0 - tx0 * sx, ry0 - ty0 * sy];
}

function flattenOne(page: PDFPage, ref: PDFRef, dict: PDFDict): boolean {
  const flags = lookupNumber(dict, 'F') ?? 0;
  if (flags & FLAG_HIDDEN || flags & FLAG_NOVIEW) return true; // removed, not drawn
  const ap = normalAppearance(dict);
  const rect = numbers(dict.lookup(PDFName.of('Rect')) as PDFArray | undefined, 4);
  if (!ap || !rect) return false; // nothing to bake; leave the annotation alone
  const bbox = numbers(ap.stream.dict.lookup(PDFName.of('BBox')) as PDFArray | undefined, 4) ?? [
    0, 0, 1, 1,
  ];
  const matrix = numbers(
    ap.stream.dict.lookup(PDFName.of('Matrix')) as PDFArray | undefined,
    6,
  ) ?? [1, 0, 0, 1, 0, 0];
  const m = appearanceMatrix(
    bbox as [number, number, number, number],
    matrix as [number, number, number, number, number, number],
    rect as [number, number, number, number],
  );
  const name = page.node.newXObject('RLFlat', ap.ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]),
    drawObject(name),
    popGraphicsState(),
  );
  void ref;
  return true;
}

/**
 * Bake annotations into page content and remove them. Returns how many were flattened.
 * Annotations without an appearance (nothing to draw) are left in place.
 */
export function flattenMarkups(doc: RedlineDocument, options: FlattenOptions = {}): number {
  const context = doc.pdfDoc.context;
  const pages = options.pages ?? doc.pageSizes.map((_, i) => i);
  const only = options.ids ? new Set(options.ids) : undefined;
  const removed = new Set<string>();
  let count = 0;

  for (const pageIndex of pages) {
    const page = doc.pdfDoc.getPage(pageIndex);
    const annots = page.node.Annots();
    if (!(annots instanceof PDFArray)) continue;
    const keep: (PDFRef | PDFDict)[] = [];
    const popupsToDrop = new Set<string>();
    for (let i = 0; i < annots.size(); i += 1) {
      const raw = annots.get(i);
      const dict = annots.lookup(i);
      if (!(dict instanceof PDFDict) || !(raw instanceof PDFRef)) {
        if (raw instanceof PDFRef || raw instanceof PDFDict) keep.push(raw);
        continue;
      }
      const subtype = dict.get(PDFName.of('Subtype'));
      if (subtype === PDFName.of('Popup')) {
        keep.push(raw); // decided below, once we know whether the parent went
        continue;
      }
      const nm = lookupText(dict, 'NM');
      if (only && (!nm || !only.has(nm))) {
        keep.push(raw);
        continue;
      }
      if (!flattenOne(page, raw, dict)) {
        keep.push(raw);
        continue;
      }
      const popup = dict.get(PDFName.of('Popup'));
      if (popup instanceof PDFRef) popupsToDrop.add(popup.toString());
      context.delete(raw);
      if (nm) removed.add(nm);
      count += 1;
    }
    const remaining = keep.filter((entry) => {
      if (!(entry instanceof PDFRef)) return true;
      if (!popupsToDrop.has(entry.toString())) return true;
      context.delete(entry);
      return false;
    });
    if (remaining.length === 0) {
      page.node.delete(PDFName.of('Annots'));
    } else {
      const next = PDFArray.withContext(context);
      for (const entry of remaining) next.push(entry);
      page.node.set(PDFName.of('Annots'), next);
    }
  }

  if (count > 0) {
    doc.markups = doc.markups.filter((m) => !removed.has(m.id));
  }
  return count;
}
