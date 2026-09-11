/**
 * Measurement writers and the move operation. PLAN §3.4 ownership rule, §3.6, Appendix A.
 *
 * VERIFIED against the Revu fixture's own `/Line` (object 128) and `/Polygon` (322):
 * every key written here appears there in the same form, and every measurement carries
 * its OWN `/Measure` object rather than a reference shared with the page viewport.
 */

import type { PDFDict } from '@cantoo/pdf-lib';
import { PDFArray, PDFName, PDFNumber, PDFString, type PDFContext, PDFRef } from '@cantoo/pdf-lib';
import type {
  Geometry,
  LineEnding,
  Markup,
  PageScale,
  Point,
  Rect,
  RedlineDocument,
  RGB,
  Scale,
  UnitFormat,
} from '../types.js';
import { generateUniqueNM } from '../ids.js';
import { formatArea, formatLength } from '../measure/format.js';
import { buildMeasureDict } from '../measure/measureDict.js';
import { computeMeasurement } from '../measure/compute.js';
import { boundsOf, translatePoints, translateRect } from '../measure/geometry.js';
import { colorArray, lookupText, numArray, pdfDate, pdfText, round } from './dict.js';
import { borderStyle, lineEndingsArray, writeCommonKeys } from './common.js';
import { regenerateShapeAppearance } from './shapes.js';
import { regenerateTextAppearance } from './text.js';
import { isPlaceholderId, requireMarkup } from '../document/open.js';
import { annotsArrayForWrite, markChanged } from '../document/save.js';
import { buildFormXObject, setAppearance } from './ap/form.js';
import {
  buildCircleAppearance,
  buildLineAppearance,
  buildPolygonAppearance,
  buildPolylineAppearance,
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

/** Polylength / perimeter: the length style without leaders (a polyline has no /LL). */
export const DEFAULT_POLYLINE_STYLE: MeasurementStyle = {
  stroke: { r: 0.83, g: 0.18, b: 0.18 },
  width: 2,
  opacity: 1,
  lineEnds: ['None', 'None'],
  captionSize: 10,
};

/** Count symbol: a small filled disc in points, independent of the page scale. */
export const DEFAULT_COUNT_STYLE: CountStyle = {
  stroke: { r: 0.83, g: 0.18, b: 0.18 },
  fill: { r: 0.83, g: 0.18, b: 0.18 },
  fillOpacity: 0.6,
  width: 1,
  opacity: 1,
  radius: 6,
};

export interface CountStyle {
  stroke: RGB;
  fill: RGB;
  fillOpacity: number;
  width: number;
  opacity: number;
  /** Symbol radius in points. */
  radius: number;
}

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
  /** `/RLTool`: the tool chest tool that made the markup. */
  tool?: string;
  /** `/RLAttrs`: attribute values for formula columns. */
  attrs?: Record<string, string | number | boolean>;
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

function polylineAppearanceFor(
  points: Point[],
  style: MeasurementStyle,
  caption: string | undefined,
): AppearanceResult {
  return buildPolylineAppearance({
    points,
    stroke: style.stroke,
    width: style.width,
    ...(style.dash && { dash: style.dash }),
    lineEnds: style.lineEnds ?? ['None', 'None'],
    opacity: style.opacity,
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
    ...(options.tool && { tool: options.tool }),
    ...(options.attrs && { attrs: options.attrs }),
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
    ...(options.tool && { tool: options.tool }),
    ...(options.attrs && { attrs: options.attrs }),
    flags: { locked: false, hidden: false, print: true },
    raw: annot,
    ref,
    render: 'native',
  };
  refreshMeasurement(doc, markup, style);
  doc.markups.push(markup);
  return markup;
}

export interface PolylineOptions extends MeasurementOptions {
  /**
   * Perimeter: close the run by repeating the first vertex, so a plain
   * `/PolyLineDimension` measures the whole loop. This is what Acrobat's perimeter tool
   * writes (VERIFIED against Acrobat output in the ISO 32000 examples); Revu's own
   * perimeter representation is ASSUMED compatible until a fixture shows otherwise.
   */
  closed?: boolean;
}

/**
 * Write a `/PolyLine` + `/IT /PolyLineDimension` polylength (or perimeter) measurement.
 * Vertices are user space. The page must already have a scale.
 */
export function addPolylineMeasurement(
  doc: RedlineDocument,
  pageIndex: number,
  vertices: Point[],
  options: PolylineOptions,
): Markup {
  if (vertices.length < 2) throw new RangeError('A polylength needs at least two vertices');
  const context = doc.pdfDoc.context;
  const page = doc.pdfDoc.getPage(pageIndex);
  const pageScale = requirePageScale(doc, pageIndex);
  const style: MeasurementStyle = { ...DEFAULT_POLYLINE_STYLE, ...options.style };
  const now = options.now ?? new Date();
  const nm = options.nm ?? generateUniqueNM(doc.usedNM);
  if (options.nm) doc.usedNM.add(options.nm);

  const points = [...vertices];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (options.closed && (first.x !== last.x || first.y !== last.y)) points.push({ ...first });

  const annot = context.obj({}) as PDFDict;
  writeCommonKeys(context, annot, page.ref, nm, options, style, now);
  annot.set(PDFName.of('Subtype'), PDFName.of('PolyLine'));
  annot.set(PDFName.of('IT'), PDFName.of('PolyLineDimension'));
  annot.set(
    PDFName.of('Vertices'),
    numArray(
      context,
      points.flatMap((p) => [p.x, p.y]),
    ),
  );
  annot.set(PDFName.of('LE'), lineEndingsArray(context, style.lineEnds ?? ['None', 'None']));
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
    subtype: 'PolyLine',
    rawSubtype: 'PolyLine',
    intent: 'PolyLineDimension',
    geometry: { kind: 'poly', points, closed: false },
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
    ...(options.tool && { tool: options.tool }),
    ...(options.attrs && { attrs: options.attrs }),
    flags: { locked: false, hidden: false, print: true },
    raw: annot,
    ref,
    render: 'native',
  };
  refreshMeasurement(doc, markup, style);
  doc.markups.push(markup);
  return markup;
}

export interface CountOptions {
  /** `/RLTool`: the tool chest tool that made the markup. */
  tool?: string;
  /** `/RLAttrs`: attribute values for formula columns. */
  attrs?: Record<string, string | number | boolean>;
  /** `/Subj` — what is being counted; the Markups List groups rows by it. */
  subject: string;
  author: string;
  /**
   * Count group id shared by every symbol of one count. Stored in `/RLAttrs` so Redline
   * can total and delete the set; other viewers see N plain `/Circle` markups with the
   * same subject (PLAN §7: standard markups + /RLAttrs until Revu's count form is verified).
   */
  group: string;
  style?: Partial<CountStyle>;
  now?: Date;
  nm?: string;
}

/** Attributes Redline stores on a count symbol in `/RLAttrs` (docs/extension-keys.md). */
export interface CountAttrs {
  count: 1;
  group: string;
}

/**
 * Write one count symbol: a `/Circle` annotation with a generated `/AP`, `/RLTool (count)`
 * and `/RLAttrs`. No `/Measure` — a count is not a measurement in ISO 32000 terms.
 */
export function addCountMarkup(
  doc: RedlineDocument,
  pageIndex: number,
  center: Point,
  options: CountOptions,
): Markup {
  const context = doc.pdfDoc.context;
  const page = doc.pdfDoc.getPage(pageIndex);
  const style: CountStyle = { ...DEFAULT_COUNT_STYLE, ...options.style };
  const now = options.now ?? new Date();
  const nm = options.nm ?? generateUniqueNM(doc.usedNM);
  if (options.nm) doc.usedNM.add(options.nm);

  const annot = context.obj({}) as PDFDict;
  writeCommonKeys(
    context,
    annot,
    page.ref,
    nm,
    { subject: options.subject, author: options.author, tool: options.tool, attrs: options.attrs },
    { stroke: style.stroke, fill: style.fill, opacity: style.opacity, width: style.width },
    now,
  );
  annot.set(PDFName.of('Subtype'), PDFName.of('Circle'));
  annot.set(PDFName.of('Contents'), PDFString.of(''));
  annot.set(PDFName.of('RLTool'), PDFString.of(options.tool ?? 'count'));
  const attrs: CountAttrs & Record<string, string | number | boolean> = {
    ...(options.attrs ?? {}),
    count: 1,
    group: options.group,
  };
  annot.set(PDFName.of('RLAttrs'), PDFString.of(JSON.stringify(attrs)));

  const appearance = buildCircleAppearance({
    center,
    radius: style.radius,
    stroke: style.stroke,
    fill: style.fill,
    width: style.width,
    opacity: style.opacity,
    fillOpacity: style.fillOpacity,
  });
  const rect = attachAppearance(context, annot, appearance, {
    stroke: style.opacity,
    fill: style.fillOpacity,
  });

  const ref = context.register(annot);
  annotsArrayForWrite(doc, pageIndex).push(ref);

  const markup: Markup = {
    id: nm,
    pageIndex,
    subtype: 'Circle',
    rawSubtype: 'Circle',
    geometry: { kind: 'rect', rect },
    rect,
    style: {
      stroke: style.stroke,
      fill: style.fill,
      fillOpacity: style.fillOpacity,
      opacity: style.opacity,
      width: style.width,
    },
    text: {
      contents: '',
      subject: options.subject,
      author: options.author,
      created: now,
      modified: now,
    },
    attrs,
    ...(options.tool && { tool: options.tool }),
    relations: {},
    flags: { locked: false, hidden: false, print: true },
    raw: annot,
    ref,
    render: 'native',
  };
  doc.markups.push(markup);
  return markup;
}

/** The count group a markup belongs to, if it is a Redline count symbol. */
export function countGroupOf(markup: Markup): string | undefined {
  // A count symbol is one whose /RLAttrs carry `count: 1` and a group; /RLTool may name
  // the chest tool that made it (or the literal `count` for tool-less counts).
  try {
    const attrs = JSON.parse(lookupText(markup.raw, 'RLAttrs') ?? '{}') as Partial<CountAttrs>;
    if (attrs.count !== 1) return undefined;
    return typeof attrs.group === 'string' ? attrs.group : undefined;
  } catch {
    return undefined;
  }
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
  const base =
    markup.subtype === 'Polygon'
      ? DEFAULT_AREA_STYLE
      : markup.subtype === 'PolyLine'
        ? DEFAULT_POLYLINE_STYLE
        : DEFAULT_LENGTH_STYLE;
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
  const pageScale = effectiveScale(doc, markup);
  const showCaption = markup.measure?.caption !== false;

  // A translation does not change the measured value, so an existing caption (Revu's
  // own `/Contents`) is reused verbatim and `/Contents`/`/RC` are left untouched. Only
  // a freshly created markup gets its caption from the formatter.
  const existing = lookupText(markup.raw, 'Contents');
  // The measured value always goes to /Contents (the Markups List shows it even when the
  // caption is off, as Revu does); only the drawn caption follows /Cap.
  const value =
    mode === 'move' && existing !== undefined
      ? existing
      : pageScale
        ? captionFor(markup, pageScale)
        : '';
  const caption = showCaption ? value : '';

  if (pageScale && markup.measure) markup.measure.computed = computeMeasurement(markup, pageScale);

  let appearance: AppearanceResult;
  if (markup.geometry.kind === 'line') {
    appearance = lineAppearanceFor(markup.geometry.points, style, caption);
  } else if (markup.geometry.kind === 'poly' && markup.geometry.closed) {
    appearance = polygonAppearanceFor(markup.geometry.points, style, caption);
  } else if (markup.geometry.kind === 'poly') {
    appearance = polylineAppearanceFor(markup.geometry.points, style, caption);
  } else {
    return;
  }

  markup.rect = attachAppearance(context, markup.raw, appearance, alphaFor(style));
  if (pageScale && mode === 'create') {
    markup.raw.set(PDFName.of('Contents'), pdfText(value));
    if (markup.text) markup.text.contents = value;
    // Keep Bluebeam's rich text in step with /Contents (PLAN §3.6).
    const rc = lookupText(markup.raw, 'RC');
    if (rc !== undefined) {
      const synced = rc.replace(/>([^<]*)<\/body>/, () => `>${escapeXml(value)}</body>`);
      markup.raw.set(PDFName.of('RC'), pdfText(synced));
      if (markup.text) markup.text.richText = synced;
    }
  }
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface MarkupPatch {
  /** `/Subj`. */
  subject?: string;
  /** `/C`. */
  stroke?: RGB;
  /** `/IC`; `null` removes the fill. */
  fill?: RGB | null;
  /** `/BS /W`. */
  width?: number;
  /** `/CA`, 0..1. */
  opacity?: number;
  /** `/BS /D`; empty array => solid. */
  dash?: number[];
  /** `/RLAttrs`: merged into the existing attribute values. */
  attrs?: Record<string, string | number | boolean>;
  /** `/RLTool`. */
  tool?: string;
}

/** The scale a measurement is read with: its own override when it has one, else the page's. */
export function effectiveScale(doc: RedlineDocument, markup: Markup): PageScale | undefined {
  if (markup.measure?.own) {
    return { scale: markup.measure.scale, units: markup.measure.units, fromDocument: false };
  }
  return doc.pageScales.get(markup.pageIndex);
}

/** Replace the markup's `/Measure` (reusing its object number when it is indirect). */
function writeOwnMeasure(
  doc: RedlineDocument,
  markup: Markup,
  scale: Scale,
  units: UnitFormat,
): void {
  const context = doc.pdfDoc.context;
  const dict = buildMeasureDict(context, { scale, format: units });
  const existing = markup.raw.get(PDFName.of('Measure'));
  if (existing instanceof PDFRef) {
    context.assign(existing, dict);
    markChanged(doc, existing);
  } else {
    markup.raw.set(PDFName.of('Measure'), context.register(dict));
  }
}

/**
 * Give one measurement its own scale (PLAN §3.7 per-markup override): its `/Measure` is
 * rewritten, the value and caption recomputed, and page recalibration leaves it alone.
 */
export function setMarkupScale(
  doc: RedlineDocument,
  id: string,
  scale: Scale,
  units: UnitFormat,
  now: Date = new Date(),
): Markup {
  const markup = requireMarkup(doc, id);
  if (!markup.measure || !isMeasurementMarkup(markup)) return markup;
  ensureNM(doc, markup);
  writeOwnMeasure(doc, markup, scale, units);
  markup.measure.scale = scale;
  markup.measure.units = units;
  markup.measure.own = true;
  refreshMeasurement(doc, markup, styleFromMarkup(markup), 'create');
  markup.raw.set(PDFName.of('M'), PDFString.of(pdfDate(now)));
  if (markup.text) markup.text.modified = now;
  markChanged(doc, markup.ref);
  return markup;
}

/** Back to the page scale. Requires the page to have one. */
export function clearMarkupScale(doc: RedlineDocument, id: string, now: Date = new Date()): Markup {
  const markup = requireMarkup(doc, id);
  const pageScale = doc.pageScales.get(markup.pageIndex);
  if (!markup.measure || !pageScale) return markup;
  ensureNM(doc, markup);
  writeOwnMeasure(doc, markup, pageScale.scale, pageScale.units);
  markup.measure.scale = pageScale.scale;
  markup.measure.units = pageScale.units;
  delete markup.measure.own;
  refreshMeasurement(doc, markup, styleFromMarkup(markup), 'create');
  markup.raw.set(PDFName.of('M'), PDFString.of(pdfDate(now)));
  if (markup.text) markup.text.modified = now;
  markChanged(doc, markup.ref);
  return markup;
}

/** Show or hide a measurement's caption (`/Cap`), regenerating its appearance. */
export function setMeasurementCaption(
  doc: RedlineDocument,
  id: string,
  show: boolean,
  now: Date = new Date(),
): Markup {
  const markup = requireMarkup(doc, id);
  if (!markup.measure || !isMeasurementMarkup(markup)) return markup;
  ensureNM(doc, markup);
  markup.raw.set(PDFName.of('Cap'), doc.pdfDoc.context.obj(show));
  markup.measure.caption = show;
  refreshMeasurement(doc, markup, styleFromMarkup(markup), 'create');
  markup.raw.set(PDFName.of('M'), PDFString.of(pdfDate(now)));
  if (markup.text) markup.text.modified = now;
  markChanged(doc, markup.ref);
  return markup;
}

/** True when Redline can rebuild this markup's appearance from its geometry. */
export function canRegenerateAppearance(markup: Markup): boolean {
  if (countGroupOf(markup)) return true;
  if (isMeasurementMarkup(markup)) {
    return markup.geometry.kind === 'line' || markup.geometry.kind === 'poly';
  }
  if (markup.rawSubtype === 'FreeText') return markup.geometry.kind === 'rect';
  return isRedlineShape(markup);
}

function isMeasurementMarkup(markup: Markup): boolean {
  return (
    markup.intent === 'LineDimension' ||
    markup.intent === 'PolyLineDimension' ||
    markup.intent === 'PolygonDimension'
  );
}

/**
 * A plain shape whose appearance Redline can rebuild: Square/Circle/Line/PolyLine/
 * Polygon/Ink with geometry we parsed. Foreign shapes qualify too — their dictionary is
 * standard — so a restyled Revu rectangle gets a fresh, correct appearance.
 */
function isRedlineShape(markup: Markup): boolean {
  const g = markup.geometry;
  // A border effect we cannot draw is left to its author; a cloudy Polygon we can redraw.
  if (
    markup.raw.has(PDFName.of('BE')) &&
    !(markup.rawSubtype === 'Polygon' && markup.style.cloud)
  ) {
    return false;
  }
  switch (markup.rawSubtype) {
    case 'Square':
    case 'Circle':
      return g.kind === 'rect';
    case 'Line':
      return g.kind === 'line';
    case 'PolyLine':
    case 'Polygon':
      return g.kind === 'poly';
    case 'Ink':
      return g.kind === 'ink';
    default:
      return false;
  }
}

/**
 * Change a markup's subject and/or style. Rewrites only owned keys (PLAN §3.4) and bumps
 * `/M`. The `/AP` is regenerated when Redline can draw the markup; otherwise the existing
 * appearance stream is kept — the dictionary is right and Revu regenerates its own AP on
 * edit, but Chrome/Acrobat will show the old colours until then (ASSUMED acceptable for
 * foreign markups; Phase 2 AP generators per subtype close this gap).
 */
export function updateMarkupProperties(
  doc: RedlineDocument,
  id: string,
  patch: MarkupPatch,
  now: Date = new Date(),
): Markup {
  const markup = requireMarkup(doc, id);
  const context = doc.pdfDoc.context;
  const raw = markup.raw;
  ensureNM(doc, markup);

  if (patch.subject !== undefined) {
    raw.set(PDFName.of('Subj'), pdfText(patch.subject));
    markup.text = { contents: '', author: '', ...markup.text, subject: patch.subject };
  }
  if (patch.stroke) {
    raw.set(PDFName.of('C'), colorArray(context, patch.stroke));
    markup.style.stroke = patch.stroke;
  }
  if (patch.fill === null) {
    raw.delete(PDFName.of('IC'));
    delete markup.style.fill;
  } else if (patch.fill) {
    raw.set(PDFName.of('IC'), colorArray(context, patch.fill));
    markup.style.fill = patch.fill;
  }
  if (patch.opacity !== undefined) {
    const opacity = Math.max(0, Math.min(1, patch.opacity));
    raw.set(PDFName.of('CA'), PDFNumber.of(round(opacity)));
    markup.style.opacity = opacity;
  }
  if (patch.attrs) {
    markup.attrs = { ...(markup.attrs ?? {}), ...patch.attrs };
    raw.set(PDFName.of('RLAttrs'), PDFString.of(JSON.stringify(markup.attrs)));
  }
  if (patch.tool !== undefined) {
    raw.set(PDFName.of('RLTool'), PDFString.of(patch.tool));
    markup.tool = patch.tool;
  }
  if (patch.width !== undefined || patch.dash !== undefined) {
    const width = patch.width ?? markup.style.width;
    const dash = patch.dash ?? markup.style.dash;
    raw.set(PDFName.of('BS'), borderStyle(context, width, dash));
    markup.style.width = width;
    if (dash && dash.length) markup.style.dash = dash;
    else delete markup.style.dash;
  }

  if (canRegenerateAppearance(markup)) {
    if (markup.rawSubtype === 'FreeText') {
      regenerateTextAppearance(doc, markup);
    } else if (!countGroupOf(markup) && !isMeasurementMarkup(markup)) {
      regenerateShapeAppearance(doc, markup);
    } else if (countGroupOf(markup)) {
      const rect = markup.rect;
      const radius = (rect[2] - rect[0]) / 2 - Math.max(markup.style.width, 1);
      const appearance = buildCircleAppearance({
        center: { x: (rect[0] + rect[2]) / 2, y: (rect[1] + rect[3]) / 2 },
        radius: Math.max(1, radius),
        stroke: markup.style.stroke ?? DEFAULT_COUNT_STYLE.stroke,
        fill: markup.style.fill ?? DEFAULT_COUNT_STYLE.fill,
        width: markup.style.width,
        opacity: markup.style.opacity,
        fillOpacity: markup.style.fillOpacity ?? DEFAULT_COUNT_STYLE.fillOpacity,
      });
      markup.rect = attachAppearance(context, raw, appearance, {
        stroke: markup.style.opacity,
        fill: markup.style.fillOpacity ?? DEFAULT_COUNT_STYLE.fillOpacity,
      });
      markup.geometry = { kind: 'rect', rect: markup.rect };
    } else {
      refreshMeasurement(doc, markup, styleFromMarkup(markup), 'move');
    }
  }

  raw.set(PDFName.of('M'), PDFString.of(pdfDate(now)));
  if (markup.text) markup.text.modified = now;
  markChanged(doc, markup.ref);
  return markup;
}

/**
 * Replace a markup's geometry (vertex edit / resize). Geometry keys and `/Rect` are
 * rewritten; a measurement gets a new value, caption, `/Contents` (and `/RC` mirror) and
 * `/AP`; other markups keep their existing appearance stream, which maps onto the new
 * `/Rect`. `/M` is bumped. Nothing else is touched.
 */
export function setMarkupGeometry(
  doc: RedlineDocument,
  id: string,
  geometry: Geometry,
  now: Date = new Date(),
): Markup {
  const markup = requireMarkup(doc, id);
  const context = doc.pdfDoc.context;
  const raw = markup.raw;
  if (geometry.kind !== markup.geometry.kind) {
    throw new Error(`Cannot change geometry kind ${markup.geometry.kind} -> ${geometry.kind}`);
  }
  ensureNM(doc, markup);
  markup.geometry = geometry;

  switch (geometry.kind) {
    case 'line': {
      const [p, q] = geometry.points;
      raw.set(PDFName.of('L'), numArray(context, [p.x, p.y, q.x, q.y]));
      break;
    }
    case 'poly':
      raw.set(
        PDFName.of('Vertices'),
        numArray(
          context,
          geometry.points.flatMap((p) => [p.x, p.y]),
        ),
      );
      break;
    case 'ink': {
      const inkList = PDFArray.withContext(context);
      for (const path of geometry.paths) {
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
    case 'quads':
      raw.set(PDFName.of('QuadPoints'), numArray(context, geometry.quads));
      break;
    case 'rect':
    case 'none':
      break;
  }

  if (canRegenerateAppearance(markup) && !countGroupOf(markup) && isMeasurementMarkup(markup)) {
    // A real edit: recompute the value, caption, /Contents (+ /RC) and the appearance.
    refreshMeasurement(doc, markup, styleFromMarkup(markup), 'create');
  } else if (markup.rawSubtype === 'FreeText' && regenerateTextAppearance(doc, markup)) {
    // A text box: re-wrap the text to the new box.
  } else if (!countGroupOf(markup) && regenerateShapeAppearance(doc, markup)) {
    // A shape: redraw at the new geometry (a stretched /AP would distort the stroke).
  } else {
    const rect: Rect =
      geometry.kind === 'rect' || geometry.kind === 'none' || geometry.kind === 'quads'
        ? geometry.rect
        : boundsOf(
            geometry.kind === 'ink' ? geometry.paths.flat() : geometry.points,
            Math.max(markup.style.width, 1) * 2,
          );
    markup.rect = [round(rect[0]), round(rect[1]), round(rect[2]), round(rect[3])];
    raw.set(PDFName.of('Rect'), numArray(context, markup.rect));
  }

  raw.set(PDFName.of('M'), PDFString.of(pdfDate(now)));
  if (markup.text) markup.text.modified = now;
  markChanged(doc, markup.ref);
  return markup;
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
    if (markup.callout) markup.callout = translatePoints(markup.callout, dx, dy);
  }

  const isMeasurement =
    markup.intent === 'LineDimension' ||
    markup.intent === 'PolygonDimension' ||
    markup.intent === 'PolyLineDimension';
  if (isMeasurement && (markup.geometry.kind === 'line' || markup.geometry.kind === 'poly')) {
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
