/**
 * Page scale as a `/VP` viewport. PLAN §3.6 "Page scale" + Appendix A.
 *
 * VERIFIED against Revu 21 (`fixtures/Takeoff bluebeam copy 16228 Sharon Drive - Urbandale.pdf`):
 *
 *   97 0 obj [98 0 R]
 *   98 0 obj <</Type/Viewport/BBox[0 0 2592 1728]/Measure 99 0 R/NM(BUULQOYKDWTRIJOI)>>
 *
 * Two things differ from PLAN Appendix A and follow the fixture instead (ADR-0003):
 *   1. Revu identifies a viewport with `/NM` (16 uppercase letters), not `/Name`.
 *   2. Revu gives every page its own `/Measure` object rather than sharing one ref.
 *
 * ASSUMED: when several viewports cover the same area, the LAST entry in `/VP` wins.
 * `setPageScale` therefore appends, and replaces only the viewport Redline itself wrote
 * on that page — pre-existing entries (CAD exports often carry dozens) are never removed.
 */

import { PDFArray, PDFDict, PDFName, PDFRef, PDFString, type PDFPage } from '@cantoo/pdf-lib';
import type { PageScale, RedlineDocument, Scale, UnitFormat, WorldUnit } from '../types.js';
import { generateUniqueNM } from '../ids.js';
import { buildMeasureDict } from './measureDict.js';
import { computeMeasurement } from './compute.js';
import type { DisplayFormat } from './units.js';
import {
  lookupArray,
  lookupDict,
  lookupName,
  lookupNumber,
  lookupText,
  numArray,
} from '../annots/dict.js';
import { markChanged, markDeleted, markPageArrayChanged } from '../document/save.js';

/** The unit label Revu writes for each display format, used to read a scale back. */
const UNIT_BY_LABEL: Record<string, DisplayFormat> = {
  "'": 'decimal-ft',
  '"': 'in',
  ' m': 'm',
  ' mm': 'mm',
  ' cm': 'cm',
};

/**
 * Recover a `PageScale` from a `/Measure` dictionary.
 *
 * The ratio comes from `/X`'s `/C` (world units per point) rather than by parsing the
 * `/R` display string, so it is exact and independent of how the producer spelled it.
 */
export function parseMeasureDict(measure: PDFDict): PageScale | undefined {
  const x = lookupArray(measure, 'X');
  const first = x?.lookup(0);
  if (!(first instanceof PDFDict)) return undefined;
  const perPoint = lookupNumber(first, 'C');
  if (!perPoint || !Number.isFinite(perPoint) || perPoint <= 0) return undefined;

  const d = lookupArray(measure, 'D');
  const d0 = d?.lookup(0);
  const d1 = d?.lookup(1);
  const label0 = d0 instanceof PDFDict ? lookupText(d0, 'U') : undefined;
  const label1 = d1 instanceof PDFDict ? lookupText(d1, 'U') : undefined;

  // CAD exports (the D-* fixtures: ~286 viewports per page) write `/R ( )` and `/U ( )` with
  // `/C 1/72` — a 1:1 viewport with no unit. There is no world unit to measure in, so it
  // is not a page scale; the user calibrates instead. VERIFIED on D-1 Palazzo CF Slab.pdf.
  if (!label0 || !label0.trim()) return undefined;

  // Feet-inches is the two-element chain: `'` then `"`.
  const display: DisplayFormat =
    label0 === "'" && label1 === '"' ? 'ft-in' : (UNIT_BY_LABEL[label0 ?? ''] ?? 'decimal-ft');

  const style = d0 instanceof PDFDict ? lookupName(d0, 'F') : undefined;
  const denominator = d0 instanceof PDFDict ? (lookupNumber(d0, 'D') ?? 16) : 16;
  const precision =
    display === 'ft-in' || display === 'in' || style === 'F'
      ? denominator
      : Math.max(0, Math.round(Math.log10(Math.max(1, denominator))));

  const worldUnit: WorldUnit =
    display === 'ft-in' || display === 'decimal-ft'
      ? 'ft'
      : display === 'in'
        ? 'in'
        : (display as WorldUnit);

  // Express as "1 in = N world units" — 72 pt to the inch.
  return {
    scale: { pageLength: 1, pageUnit: 'in', worldLength: perPoint * 72, worldUnit },
    units: { display, precision },
    fromDocument: true,
  };
}

/** Read the effective scale for a page from its `/VP` array, if it has one. */
export function readPageScale(page: PDFPage): PageScale | undefined {
  const vp = page.node.lookup(PDFName.of('VP'));
  if (!(vp instanceof PDFArray)) return undefined;
  // Last entry wins (see the file header note), so scan backwards.
  for (let i = vp.size() - 1; i >= 0; i -= 1) {
    const viewport = vp.lookup(i);
    if (!(viewport instanceof PDFDict)) continue;
    const measure = lookupDict(viewport, 'Measure');
    if (!measure) continue;
    const parsed = parseMeasureDict(measure);
    if (parsed) return parsed;
  }
  return undefined;
}

export interface SetPageScaleOptions {
  /** Decimal places for area totals in the page `/Measure`. Revu writes 0. */
  areaDecimals?: number;
}

/**
 * Write the calibrated scale for one page as a `/VP` viewport.
 *
 * Appends to any existing `/VP` array and never removes an entry it did not create.
 * Calling this again for the same page replaces Redline's own viewport in place, so
 * re-calibrating does not stack duplicates.
 */
export function setPageScale(
  doc: RedlineDocument,
  pageIndex: number,
  scale: Scale,
  units: UnitFormat,
  options: SetPageScaleOptions = {},
): PDFRef {
  const page = doc.pdfDoc.getPage(pageIndex);
  const context = doc.pdfDoc.context;

  const measureDict = buildMeasureDict(context, {
    scale,
    format: units,
    ...(options.areaDecimals !== undefined && { areaDecimals: options.areaDecimals }),
  });
  const measureRef = context.register(measureDict);

  const box = page.getCropBox();
  const viewport = context.obj({}) as PDFDict;
  viewport.set(PDFName.of('Type'), PDFName.of('Viewport'));
  viewport.set(
    PDFName.of('BBox'),
    numArray(context, [box.x, box.y, box.x + box.width, box.y + box.height]),
  );
  viewport.set(PDFName.of('Measure'), measureRef);
  viewport.set(PDFName.of('NM'), PDFString.of(generateUniqueNM(doc.usedNM)));

  const existingOwn = doc.ownViewports.get(pageIndex);
  if (existingOwn) {
    // Re-calibration: overwrite the object we wrote last time, keeping its position.
    context.assign(existingOwn, viewport);
    doc.pageScales.set(pageIndex, { scale, units, fromDocument: false });
    refreshMeasurementsOnPage(doc, pageIndex);
    return existingOwn;
  }

  const viewportRef = context.register(viewport);
  const existing = page.node.lookup(PDFName.of('VP'));
  if (existing instanceof PDFArray) {
    existing.push(viewportRef);
  } else {
    const arr = PDFArray.withContext(context);
    arr.push(viewportRef);
    page.node.set(PDFName.of('VP'), arr);
  }
  // The holder of /VP (the page, or an indirect array) must be rewritten.
  markPageArrayChanged(doc, pageIndex, 'VP');

  doc.ownViewports.set(pageIndex, viewportRef);
  doc.pageScales.set(pageIndex, { scale, units, fromDocument: false });
  refreshMeasurementsOnPage(doc, pageIndex);
  return viewportRef;
}

/**
 * Undo a calibration Redline made in this session: remove Redline's own viewport from the
 * page's `/VP` (dropping the array only if Redline created it) and fall back to whatever
 * scale the document itself carried. Viewports Redline did not write are never touched.
 * Returns false when the page has no Redline viewport to remove.
 */
export function clearPageScale(doc: RedlineDocument, pageIndex: number): boolean {
  const own = doc.ownViewports.get(pageIndex);
  if (!own) return false;
  const page = doc.pdfDoc.getPage(pageIndex);
  const vp = page.node.lookup(PDFName.of('VP'));
  if (vp instanceof PDFArray) {
    for (let i = vp.size() - 1; i >= 0; i -= 1) if (vp.get(i) === own) vp.remove(i);
    if (vp.size() === 0) page.node.delete(PDFName.of('VP'));
  }
  markPageArrayChanged(doc, pageIndex, 'VP');
  if (vp instanceof PDFArray && vp.size() === 0) markChanged(doc, page.ref);

  const viewport = doc.pdfDoc.context.lookup(own);
  const measureRef = viewport instanceof PDFDict ? viewport.get(PDFName.of('Measure')) : undefined;
  if (measureRef instanceof PDFRef) markDeleted(doc, measureRef);
  markDeleted(doc, own);
  doc.ownViewports.delete(pageIndex);

  const documentScale = readPageScale(page);
  if (documentScale) doc.pageScales.set(pageIndex, documentScale);
  else doc.pageScales.delete(pageIndex);
  refreshMeasurementsOnPage(doc, pageIndex);
  return true;
}

/** Existing measurements on a page keep their own /Measure; only the cached numbers update. */
function refreshMeasurementsOnPage(doc: RedlineDocument, pageIndex: number): void {
  const pageScale = doc.pageScales.get(pageIndex);
  if (!pageScale) return;
  for (const markup of doc.markups) {
    if (markup.pageIndex !== pageIndex || !markup.measure) continue;
    markup.measure.scale = pageScale.scale;
    markup.measure.units = pageScale.units;
    markup.measure.computed = computeMeasurement(markup, pageScale);
  }
}
