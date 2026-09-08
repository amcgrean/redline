/**
 * Measurement writers and the move operation. PLAN §3.4 ownership rule, §3.6, Appendix A.
 *
 * VERIFIED against the Revu fixture's own `/Line` (object 128) and `/Polygon` (322):
 * every key written here appears there in the same form, and every measurement carries
 * its OWN `/Measure` object rather than a reference shared with the page viewport.
 */

import type { PDFDict, PDFRef } from '@cantoo/pdf-lib';
import { PDFArray, PDFName, PDFNumber, PDFString, type PDFContext } from '@cantoo/pdf-lib';
import type { LineEnding, Markup, PageScale, Point, Rect, RedlineDocument, RGB } from '../types.js';
import { generateUniqueNM } from '../ids.js';
import { formatArea, formatLength } from '../measure/format.js';
import { buildMeasureDict } from '../measure/measureDict.js';
import { computeMeasurement } from '../measure/compute.js';
import { translatePoints, translateRect } from '../measure/geometry.js';
import { colorArray, lookupText, numArray, pdfDate, round } from './dict.js';
import { isPlaceholderId, requireMarkup } from '../document/open.js';
import { annotsArrayForWrite, markChanged } from '../document/save.js';
import { buildFormXObject, setAppearance } from './ap/form.js';
import {
  buildLineAppearance,
  buildPolygonAppearance,
  type AppearanceResult,
} from './ap/measurement.js';

/** Opinionated defaults from PLAN §3.11: red 2 pt lines, ft-in to 1/16, Helvetica 10. */
export const DEFAULT_LENGTH_STYLE: MeasurementStyle = {
  stroke: { r: 0.83, g: 0.18, b: 0.18 },
  width: 2,
  opacity: 1,
  lineEnds: ['ClosedArrow', 'ClosedArrow'],
  leaderLength: 10,
  leaderExtension: 2,
  captionSize: 10,
};

export const DEFAULT_AREA_STYLE: MeasurementStyle = {
  stroke: { r: 0.08, g: 0.4, b: 0.75 },
  fill: { r: 0.08, g: 0.4, b: 0.75 },
  fillOpacity: 0.25,
  width: 1,
  opacity: 1,
  captionSize: 10,
};

export interface MeasurementStyle {
  stroke: RGB;
  fill?: RGB;
  /** `/CA`. */
  opacity: number;
  /** Fill alpha in the appearance stream (Bluebeam mirrors this as `/FillOpacity`). */
  fillOpacity?: number;
  /** `/BS /W`. */
  width: number;
  /** `/BS /D`; present => `/BS /S /D`. */
  dash?: number[];
  /** `/LE`. */
  lineEnds?: [LineEnding, LineEnding];
  /** `/LL`. */
  leaderLength?: number;
  /** `/LLE`. */
  leaderExtension?: number;
  /** Caption font size in points. */
  captionSize?: number;
}

export interface MeasurementOptions {
  /** `/Subj` — the Markups List "Subject". */
  subject: string;
  /** `/T` — author. */
  author: string;
  style?: Partial<MeasurementStyle>;
  /** Show the caption (`/Cap`). Defaults to true. */
  caption?: boolean;
  /** Timestamp for `/CreationDate` and `/M`; injectable for deterministic tests. */
  now?: Date;
  /** `/NM` override for deterministic tests; must be unused in the document. */
  nm?: string;
}

function requirePageScale(doc: RedlineDocument, pageIndex: number): PageScale {
  const scale = doc.pageScales.get(pageIndex);
  if (!scale) {
    throw new Error(`Page ${pageIndex + 1} has no scale; call setPageScale first`);
  }
  return scale;
}

function borderStyle(context: PDFContext, width: number, dash?: number[]): PDFDict {
  const bs = context.obj({}) as PDFDict;
  bs.set(PDFName.of('Type'), PDFName.of('Border'));
  bs.set(PDFName.of('W'), PDFNumber.of(round(width)));
  if (dash?.length) {
    bs.set(PDFName.of('S'), PDFName.of('D'));
    bs.set(PDFName.of('D'), numArray(context, dash));
  } else {
    bs.set(PDFName.of('S'), PDFName.of('S'));
  }
  return bs;
}

function lineEndingsArray(context: PDFContext, ends: [LineEnding, LineEnding]): PDFArray {
  const arr = PDFArray.withContext(context);
  arr.push(PDFName.of(ends[0]));
  arr.push(PDFName.of(ends[1]));
  return arr;
}

/** Keys shared by every new markup (PLAN §3.4 "New markups get …"). */
function writeCommonKeys(
  context: PDFContext,
  annot: PDFDict,
  pageRef: PDFRef,
  nm: string,
  options: MeasurementOptions,
  style: MeasurementStyle,
  now: Date,
): void {
  const stamp = PDFString.of(pdfDate(now));
  annot.set(PDFName.of('Type'), PDFName.of('Annot'));
  annot.set(PDFName.of('P'), pageRef);
  annot.set(PDFName.of('NM'), PDFString.of(nm));
  annot.set(PDFName.of('T'), PDFString.of(options.author));
  annot.set(PDFName.of('Subj'), PDFString.of(options.subject));
  annot.set(PDFName.of('CreationDate'), stamp);
  annot.set(PDFName.of('M'), stamp);
  // Print flag only. Hidden, NoView and Locked are all clear.
  annot.set(PDFName.of('F'), PDFNumber.of(4));
  annot.set(PDFName.of('C'), colorArray(context, style.stroke));
  if (style.fill) annot.set(PDFName.of('IC'), colorArray(context, style.fill));
  annot.set(PDFName.of('CA'), PDFNumber.of(round(style.opacity)));
  annot.set(PDFName.of('BS'), borderStyle(context, style.width, style.dash));
}

/** Attach a freshly built `/AP /N` and set `/Rect` from its bounds. */
function attachAppearance(
  context: PDFContext,
  annot: PDFDict,
  appearance: AppearanceResult,
  alpha?: { stroke: number; fill: number },
): Rect {
  const rect: Rect = [
    round(appearance.bounds[0]),
    round(appearance.bounds[1]),
    round(appearance.bounds[2]),
    round(appearance.bounds[3]),
  ];
  const stream = buildFormXObject(context, {
    bbox: rect,
    content: appearance.content,
    withFont: appearance.withFont,
    ...(alpha && (alpha.stroke < 1 || alpha.fill < 1) && { alpha }),
  });
  setAppearance(context, annot, context.register(stream));
  annot.set(PDFName.of('Rect'), numArray(context, rect));
  return rect;
}

function lineAppearanceFor(
  points: [Point, Point],
  style: MeasurementStyle,
  caption: string | undefined,
): AppearanceResult {
  return buildLineAppearance({
    start: points[0],
    end: points[1],
    stroke: style.stroke,
    width: style.width,
    ...(style.dash && { dash: style.dash }),
    lineEnds: style.lineEnds ?? ['None', 'None'],
    leaderLength: style.leaderLength ?? 0,
    leaderExtension: style.leaderExtension ?? 0,
    opacity: style.opacity,
    ...(caption && {
      caption: { text: caption, size: style.captionSize ?? 10, color: style.stroke },
    }),
  });
}

function polygonAppearanceFor(
  points: Point[],
  style: MeasurementStyle,
  caption: string | undefined,
): AppearanceResult {
  return buildPolygonAppearance({
    points,
    stroke: style.stroke,
    ...(style.fill && { fill: style.fill }),
    width: style.width,
    ...(style.dash && { dash: style.dash }),
    opacity: style.opacity,
    fillOpacity: style.fillOpacity ?? 1,
    ...(caption && {
      caption: { text: caption, size: style.captionSize ?? 10, color: style.stroke },
    }),
  });
}

function alphaFor(style: MeasurementStyle): { stroke: number; fill: number } {
  return { stroke: style.opacity, fill: style.fillOpacity ?? style.opacity };
}

/**
 * Write a `/Line` + `/IT /LineDimension` measurement between two points (user space).
 * The page must already have a scale.
 */
export function addLengthMeasurement(
  doc: RedlineDocument,
  pageIndex: number,
  start: Point,
  end: Point,
  options: MeasurementOptions,
): Markup {
  const context = doc.pdfDoc.context;
  const page = doc.pdfDoc.getPage(pageIndex);
  const pageScale = requirePageScale(doc, pageIndex);
  const style: MeasurementStyle = { ...DEFAULT_LENGTH_STYLE, ...options.style };
  const now = options.now ?? new Date();
  const nm = options.nm ?? generateUniqueNM(doc.usedNM);
  if (options.nm) doc.usedNM.add(options.nm);

  const annot = context.obj({}) as PDFDict;
  writeCommonKeys(context, annot, page.ref, nm, options, style, now);
  annot.set(PDFName.of('Subtype'), PDFName.of('Line'));
  annot.set(PDFName.of('IT'), PDFName.of('LineDimension'));
  annot.set(PDFName.of('L'), numArray(context, [start.x, start.y, end.x, end.y]));
  annot.set(PDFName.of('LE'), lineEndingsArray(context, style.lineEnds ?? ['None', 'None']));
  annot.set(PDFName.of('LL'), PDFNumber.of(round(style.leaderLength ?? 0)));
  annot.set(PDFName.of('LLE'), PDFNumber.of(round(style.leaderExtension ?? 0)));
  annot.set(PDFName.of('Cap'), context.obj(options.caption ?? true));
  annot.set(PDFName.of('CP'), PDFName.of('Top'));
  // Own copy of the page's /Measure, exactly as Revu does.
  annot.set(
    PDFName.of('Measure'),
    context.register(
      buildMeasureDict(context, { scale: pageScale.scale, format: pageScale.units }),
    ),
  );

  const ref = context.register(annot);
  annotsArrayForWrite(doc, pageIndex).push(ref);

  const markup: Markup = {
    id: nm,
    pageIndex,
    subtype: 'Line',
    rawSubtype: 'Line',
    intent: 'LineDimension',
    geometry: { kind: 'line', points: [start, end] },
    rect: [0, 0, 0, 0],
    style: {
      stroke: style.stroke,
      opacity: style.opacity,
      width: style.width,
      ...(style.dash && { dash: style.dash }),
      ...(style.lineEnds && { lineEnds: style.lineEnds }),
    },
    text: {
      contents: '',
      subject: options.subject,
      author: options.author,
      created: now,
      modified: now,
    },
    measure: {
      scale: pageScale.scale,
      units: pageScale.units,
      caption: options.caption ?? true,
      computed: {},
    },
    relations: {},
    flags: { locked: false, hidden: false, print: true },
    raw: annot,
    ref,
    render: 'native',
  };
  refreshMeasurement(doc, markup, style);
  doc.markups.push(markup);
  return markup;
}

/**
 * Write a `/Polygon` + `/IT /PolygonDimension` area measurement. Vertices are user space;
 * the polygon is implicitly closed. The page must already have a scale.
 */
export function addAreaMeasurement(
  doc: RedlineDocument,
  pageIndex: number,
  vertices: Point[],
  options: MeasurementOptions,
): Markup {
  if (vertices.length < 3) throw new RangeError('An area needs at least three vertices');
  const context = doc.pdfDoc.context;
  const page = doc.pdfDoc.getPage(pageIndex);
  const pageScale = requirePageScale(doc, pageIndex);
  const style: MeasurementStyle = { ...DEFAULT_AREA_STYLE, ...options.style };
  const now = options.now ?? new Date();
  const nm = options.nm ?? generateUniqueNM(doc.usedNM);
  if (options.nm) doc.usedNM.add(options.nm);

  const annot = context.obj({}) as PDFDict;
  writeCommonKeys(context, annot, page.ref, nm, options, style, now);
  annot.set(PDFName.of('Subtype'), PDFName.of('Polygon'));
  annot.set(PDFName.of('IT'), PDFName.of('PolygonDimension'));
  annot.set(
    PDFName.of('Vertices'),
    numArray(
      context,
      vertices.flatMap((p) => [p.x, p.y]),
    ),
  );
  annot.set(PDFName.of('Cap'), context.obj(options.caption ?? true));
  annot.set(
    PDFName.of('Measure'),
    context.register(
      buildMeasureDict(context, { scale: pageScale.scale, format: pageScale.units }),
    ),
  );

  const ref = context.register(annot);
  annotsArrayForWrite(doc, pageIndex).push(ref);

  const markup: Markup = {
    id: nm,
    pageIndex,
    subtype: 'Polygon',
    rawSubtype: 'Polygon',
    intent: 'PolygonDimension',
    geometry: { kind: 'poly', points: [...vertices], closed: true },
    rect: [0, 0, 0, 0],
    style: {
      stroke: style.stroke,
      ...(style.fill && { fill: style.fill }),
      ...(style.fillOpacity !== undefined && { fillOpacity: style.fillOpacity }),
      opacity: style.opacity,
      width: style.width,
      ...(style.dash && { dash: style.dash }),
    },
    text: {
      contents: '',
      subject: options.subject,
      author: options.author,
      created: now,
      modified: now,
    },
    measure: {
      scale: pageScale.scale,
      units: pageScale.units,
      caption: options.caption ?? true,
      computed: {},
    },
    relations: {},
    flags: { locked: false, hidden: false, print: true },
    raw: annot,
    ref,
    render: 'native',
  };
  refreshMeasurement(doc, markup, style);
  doc.markups.push(markup);
  return markup;
}

/** The caption text for a measurement — the single formatter is the only source. */
export function captionFor(markup: Markup, pageScale: PageScale): string {
  const computed = computeMeasurement(markup, pageScale);
  const unit = pageScale.scale.worldUnit;
  if (computed.area !== undefined && markup.geometry.kind === 'poly') {
    return formatArea(computed.area, pageScale.units, unit);
  }
  if (computed.length !== undefined) return formatLength(computed.length, pageScale.units, unit);
  return '';
}

/** Style values a regenerated AP needs, read back from the live dictionary. */
function styleFromMarkup(markup: Markup): MeasurementStyle {
  const base = markup.subtype === 'Polygon' ? DEFAULT_AREA_STYLE : DEFAULT_LENGTH_STYLE;
  const raw = markup.raw;
  const ll = raw.lookup(PDFName.of('LL'));
  const lle = raw.lookup(PDFName.of('LLE'));
  return {
    ...base,
    stroke: markup.style.stroke ?? base.stroke,
    ...(markup.style.fill ? { fill: markup.style.fill } : { fill: undefined }),
    ...(markup.style.fillOpacity !== undefined && { fillOpacity: markup.style.fillOpacity }),
    opacity: markup.style.opacity,
    width: markup.style.width,
    ...(markup.style.dash && { dash: markup.style.dash }),
    ...(markup.style.lineEnds && { lineEnds: markup.style.lineEnds }),
    ...(ll instanceof PDFNumber && { leaderLength: ll.asNumber() }),
    ...(lle instanceof PDFNumber && { leaderExtension: lle.asNumber() }),
  };
}

/**
 * Recompute a measurement's value, caption, `/Contents`, `/AP` and `/Rect` from its
 * geometry. Called after creation and after every geometry edit.
 */
function refreshMeasurement(
  doc: RedlineDocument,
  markup: Markup,
  style: MeasurementStyle,
  mode: 'create' | 'move' = 'create',
): void {
  const context = doc.pdfDoc.context;
  const pageScale = doc.pageScales.get(markup.pageIndex);
  const showCaption = markup.measure?.caption !== false;

  // A translation does not change the measured value, so an existing caption (Revu's
  // own `/Contents`) is reused verbatim and `/Contents`/`/RC` are left untouched. Only
  // a freshly created markup gets its caption from the formatter.
  const existing = lookupText(markup.raw, 'Contents');
  const caption = !showCaption
    ? ''
    : mode === 'move' && existing !== undefined
      ? existing
      : pageScale
        ? captionFor(markup, pageScale)
        : '';

  if (pageScale && markup.measure) markup.measure.computed = computeMeasurement(markup, pageScale);

  let appearance: AppearanceResult;
  if (markup.geometry.kind === 'line') {
    appearance = lineAppearanceFor(markup.geometry.points, style, caption);
  } else if (markup.geometry.kind === 'poly') {
    appearance = polygonAppearanceFor(markup.geometry.points, style, caption);
  } else {
    return;
  }

  markup.rect = attachAppearance(context, markup.raw, appearance, alphaFor(style));
  if (pageScale && mode === 'create') {
    markup.raw.set(PDFName.of('Contents'), PDFString.of(caption));
    if (markup.text) markup.text.contents = caption;
    // Keep Bluebeam's rich text in step with /Contents (PLAN §3.6).
    const rc = lookupText(markup.raw, 'RC');
    if (rc !== undefined) {
      const synced = rc.replace(/>([^<]*)<\/body>/, () => `>${escapeXml(caption)}</body>`);
      markup.raw.set(PDFName.of('RC'), PDFString.of(synced));
      if (markup.text) markup.text.richText = synced;
    }
  }
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Assign a real `/NM` to a markup that was loaded without one. Never changes an existing one. */
function ensureNM(doc: RedlineDocument, markup: Markup): void {
  if (!isPlaceholderId(markup.id)) return;
  if (lookupText(markup.raw, 'NM')) return;
  const nm = generateUniqueNM(doc.usedNM);
  markup.raw.set(PDFName.of('NM'), PDFString.of(nm));
  markup.id = nm;
}

/**
 * Translate a markup by `(dx, dy)` points. Updates the geometry keys and `/Rect`,
 * regenerates `/AP` for markups Redline can draw, bumps `/M`, and touches nothing else.
 *
 * Markups Redline cannot redraw (Stamp, FreeText, Unknown…) keep their existing `/AP`
 * and simply move — the form's `/BBox`/`/Matrix` map onto the new `/Rect`, so the
 * appearance follows.
 */
export function moveMarkup(
  doc: RedlineDocument,
  id: string,
  dx: number,
  dy: number,
  now: Date = new Date(),
): Markup {
  const markup = requireMarkup(doc, id);
  const context = doc.pdfDoc.context;
  const raw = markup.raw;
  ensureNM(doc, markup);

  switch (markup.geometry.kind) {
    case 'line': {
      const [a, b] = markup.geometry.points;
      markup.geometry.points = [
        { x: a.x + dx, y: a.y + dy },
        { x: b.x + dx, y: b.y + dy },
      ];
      const [p, q] = markup.geometry.points;
      raw.set(PDFName.of('L'), numArray(context, [p.x, p.y, q.x, q.y]));
      break;
    }
    case 'poly': {
      markup.geometry.points = translatePoints(markup.geometry.points, dx, dy);
      raw.set(
        PDFName.of('Vertices'),
        numArray(
          context,
          markup.geometry.points.flatMap((p) => [p.x, p.y]),
        ),
      );
      break;
    }
    case 'ink': {
      markup.geometry.paths = markup.geometry.paths.map((path) => translatePoints(path, dx, dy));
      const inkList = PDFArray.withContext(context);
      for (const path of markup.geometry.paths) {
        inkList.push(
          numArray(
            context,
            path.flatMap((p) => [p.x, p.y]),
          ),
        );
      }
      raw.set(PDFName.of('InkList'), inkList);
      break;
    }
    case 'quads': {
      markup.geometry.quads = markup.geometry.quads.map((v, i) => v + (i % 2 === 0 ? dx : dy));
      raw.set(PDFName.of('QuadPoints'), numArray(context, markup.geometry.quads));
      markup.geometry.rect = translateRect(markup.geometry.rect, dx, dy);
      break;
    }
    case 'rect':
    case 'none':
      markup.geometry.rect = translateRect(markup.geometry.rect, dx, dy);
      break;
  }

  // Callout leader (`/CL`) moves with a FreeText.
  const cl = raw.lookup(PDFName.of('CL'));
  if (cl instanceof PDFArray) {
    const values: number[] = [];
    for (let i = 0; i < cl.size(); i += 1) {
      const n = cl.lookup(i);
      if (n instanceof PDFNumber) values.push(n.asNumber() + (i % 2 === 0 ? dx : dy));
    }
    raw.set(PDFName.of('CL'), numArray(context, values));
  }

  const isMeasurement =
    markup.intent === 'LineDimension' ||
    markup.intent === 'PolygonDimension' ||
    markup.intent === 'PolyLineDimension';
  if (
    isMeasurement &&
    (markup.geometry.kind === 'line' || (markup.geometry.kind === 'poly' && markup.geometry.closed))
  ) {
    // Regenerating the AP recomputes /Rect from the drawn extents.
    refreshMeasurement(doc, markup, styleFromMarkup(markup), 'move');
  } else {
    markup.rect = translateRect(markup.rect, dx, dy);
    raw.set(PDFName.of('Rect'), numArray(context, markup.rect));
    // A moved AP still describes the same drawing: its /BBox is in form space and the
    // viewer maps it onto the new /Rect. Only a Redline-generated AP is rebuilt.
  }

  raw.set(PDFName.of('M'), PDFString.of(pdfDate(now)));
  if (markup.text) markup.text.modified = now;

  markChanged(doc, markup.ref);
  // A Popup, if any, is positioned relative to the page, not the parent; leave it.
  return markup;
}
