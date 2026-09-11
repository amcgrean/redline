/**
 * Plain markup shapes (PLAN §3.10): rectangle, ellipse, line/arrow, polyline, polygon,
 * pen. Standard ISO 32000 annotations with generated `/AP`, no `/Measure`, no `/IT`
 * (except `/LineArrow` on arrows, which Acrobat and Revu both use).
 *
 * Every shape gets the same identity/metadata keys as a measurement (`/NM`, `/T`, `/Subj`,
 * `/CreationDate`, `/M`, `/F 4`, `/C`, `/IC`, `/CA`, `/BS`) so Revu's Markups List shows it
 * with subject and author.
 */

import type { PDFDict } from '@cantoo/pdf-lib';
import { PDFArray, PDFName, type PDFContext } from '@cantoo/pdf-lib';
import type { Geometry, LineEnding, Markup, Point, Rect, RedlineDocument, RGB } from '../types.js';
import { generateUniqueNM } from '../ids.js';
import { boundsOf } from '../measure/geometry.js';
import { numArray, round } from './dict.js';
import { annotsArrayForWrite } from '../document/save.js';
import { buildFormXObject, setAppearance } from './ap/form.js';
import {
  buildLineAppearance,
  buildPolygonAppearance,
  buildPolylineAppearance,
  type AppearanceResult,
} from './ap/measurement.js';
import { buildEllipseAppearance, buildInkAppearance, buildRectAppearance } from './ap/shapes.js';
import { writeCommonKeys, type CommonStyle } from './common.js';

export type ShapeKind = 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'polyline' | 'polygon' | 'pen';

export interface ShapeStyle {
  stroke: RGB;
  fill?: RGB;
  fillOpacity?: number;
  width: number;
  opacity: number;
  dash?: number[];
  /** Line and arrow only. */
  lineEnds?: [LineEnding, LineEnding];
}

export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  stroke: { r: 0.83, g: 0.18, b: 0.18 },
  width: 2,
  opacity: 1,
};

export interface ShapeOptions {
  subject: string;
  author: string;
  style?: Partial<ShapeStyle>;
  /** `/Contents` (a note on the shape), optional. */
  contents?: string;
  now?: Date;
  nm?: string;
}

/** Geometry per kind: rectangle/ellipse take a rect, line/arrow two points, the rest points. */
export type ShapeGeometry =
  | { kind: 'rectangle' | 'ellipse'; rect: Rect }
  | { kind: 'line' | 'arrow'; start: Point; end: Point }
  | { kind: 'polyline' | 'polygon'; points: Point[] }
  | { kind: 'pen'; paths: Point[][] };

function attach(
  context: PDFContext,
  annot: PDFDict,
  appearance: AppearanceResult,
  style: ShapeStyle,
): Rect {
  const rect: Rect = [
    round(appearance.bounds[0]),
    round(appearance.bounds[1]),
    round(appearance.bounds[2]),
    round(appearance.bounds[3]),
  ];
  const alpha = { stroke: style.opacity, fill: style.fillOpacity ?? style.opacity };
  const stream = buildFormXObject(context, {
    bbox: rect,
    content: appearance.content,
    withFont: false,
    ...((alpha.stroke < 1 || alpha.fill < 1) && { alpha }),
  });
  setAppearance(context, annot, context.register(stream));
  annot.set(PDFName.of('Rect'), numArray(context, rect));
  return rect;
}

/** The appearance for a shape's current geometry. Exported so edits can regenerate it. */
export function shapeAppearance(geometry: ShapeGeometry, style: ShapeStyle): AppearanceResult {
  const fillOpacity = style.fillOpacity ?? 1;
  switch (geometry.kind) {
    case 'rectangle':
      return buildRectAppearance({ ...style, rect: geometry.rect, fillOpacity });
    case 'ellipse':
      return buildEllipseAppearance({ ...style, rect: geometry.rect, fillOpacity });
    case 'line':
    case 'arrow':
      return buildLineAppearance({
        start: geometry.start,
        end: geometry.end,
        stroke: style.stroke,
        width: style.width,
        ...(style.dash && { dash: style.dash }),
        lineEnds:
          style.lineEnds ??
          (geometry.kind === 'arrow' ? ['None', 'ClosedArrow'] : ['None', 'None']),
        leaderLength: 0,
        leaderExtension: 0,
        opacity: style.opacity,
      });
    case 'polyline':
      return buildPolylineAppearance({
        points: geometry.points,
        stroke: style.stroke,
        width: style.width,
        ...(style.dash && { dash: style.dash }),
        lineEnds: style.lineEnds ?? ['None', 'None'],
        opacity: style.opacity,
      });
    case 'polygon':
      return buildPolygonAppearance({
        points: geometry.points,
        stroke: style.stroke,
        ...(style.fill && { fill: style.fill }),
        width: style.width,
        ...(style.dash && { dash: style.dash }),
        opacity: style.opacity,
        fillOpacity,
      });
    case 'pen':
      return buildInkAppearance({
        paths: geometry.paths,
        stroke: style.stroke,
        width: style.width,
        opacity: style.opacity,
      });
  }
}

function subtypeOf(kind: ShapeKind): Markup['rawSubtype'] {
  switch (kind) {
    case 'rectangle':
      return 'Square';
    case 'ellipse':
      return 'Circle';
    case 'line':
    case 'arrow':
      return 'Line';
    case 'polyline':
      return 'PolyLine';
    case 'polygon':
      return 'Polygon';
    case 'pen':
      return 'Ink';
  }
}

/** Write a plain shape annotation. */
export function addShapeMarkup(
  doc: RedlineDocument,
  pageIndex: number,
  geometry: ShapeGeometry,
  options: ShapeOptions,
): Markup {
  const context = doc.pdfDoc.context;
  const page = doc.pdfDoc.getPage(pageIndex);
  const style: ShapeStyle = { ...DEFAULT_SHAPE_STYLE, ...options.style };
  const now = options.now ?? new Date();
  const nm = options.nm ?? generateUniqueNM(doc.usedNM);
  if (options.nm) doc.usedNM.add(options.nm);

  const annot = context.obj({}) as PDFDict;
  const common: CommonStyle = {
    stroke: style.stroke,
    ...(style.fill && { fill: style.fill }),
    opacity: style.opacity,
    width: style.width,
    ...(style.dash && { dash: style.dash }),
  };
  writeCommonKeys(
    context,
    annot,
    page.ref,
    nm,
    { subject: options.subject, author: options.author },
    common,
    now,
  );
  const subtype = subtypeOf(geometry.kind);
  annot.set(PDFName.of('Subtype'), PDFName.of(subtype));
  if (options.contents !== undefined) {
    annot.set(PDFName.of('Contents'), context.obj(options.contents));
  }

  let modelGeometry: Geometry;
  switch (geometry.kind) {
    case 'rectangle':
    case 'ellipse':
      modelGeometry = { kind: 'rect', rect: geometry.rect };
      break;
    case 'line':
    case 'arrow': {
      const { start, end } = geometry;
      annot.set(PDFName.of('L'), numArray(context, [start.x, start.y, end.x, end.y]));
      const ends: [LineEnding, LineEnding] =
        style.lineEnds ?? (geometry.kind === 'arrow' ? ['None', 'ClosedArrow'] : ['None', 'None']);
      const le = PDFArray.withContext(context);
      le.push(PDFName.of(ends[0]));
      le.push(PDFName.of(ends[1]));
      annot.set(PDFName.of('LE'), le);
      if (geometry.kind === 'arrow') annot.set(PDFName.of('IT'), PDFName.of('LineArrow'));
      modelGeometry = { kind: 'line', points: [start, end] };
      break;
    }
    case 'polyline':
    case 'polygon':
      annot.set(
        PDFName.of('Vertices'),
        numArray(
          context,
          geometry.points.flatMap((p) => [p.x, p.y]),
        ),
      );
      modelGeometry = {
        kind: 'poly',
        points: [...geometry.points],
        closed: geometry.kind === 'polygon',
      };
      break;
    case 'pen': {
      const inkList = PDFArray.withContext(context);
      for (const path of geometry.paths) {
        inkList.push(
          numArray(
            context,
            path.flatMap((p) => [p.x, p.y]),
          ),
        );
      }
      annot.set(PDFName.of('InkList'), inkList);
      modelGeometry = { kind: 'ink', paths: geometry.paths.map((p) => [...p]) };
      break;
    }
  }

  const rect = attach(context, annot, shapeAppearance(geometry, style), style);
  const ref = context.register(annot);
  annotsArrayForWrite(doc, pageIndex).push(ref);

  const markup: Markup = {
    id: nm,
    pageIndex,
    subtype: subtype as Markup['subtype'],
    rawSubtype: subtype,
    ...(geometry.kind === 'arrow' && { intent: 'LineArrow' }),
    geometry: modelGeometry,
    rect,
    style: {
      stroke: style.stroke,
      ...(style.fill && { fill: style.fill }),
      ...(style.fillOpacity !== undefined && { fillOpacity: style.fillOpacity }),
      opacity: style.opacity,
      width: style.width,
      ...(style.dash && { dash: style.dash }),
      ...(style.lineEnds && { lineEnds: style.lineEnds }),
    },
    text: {
      contents: options.contents ?? '',
      subject: options.subject,
      author: options.author,
      created: now,
      modified: now,
    },
    relations: {},
    flags: { locked: false, hidden: false, print: true },
    raw: annot,
    ref,
    render: 'native',
  };
  doc.markups.push(markup);
  return markup;
}

/**
 * Rebuild a shape's `/AP` from its current model geometry and style (used by move,
 * resize and restyle). Returns false when the markup is not a Redline-drawable shape.
 */
export function regenerateShapeAppearance(doc: RedlineDocument, markup: Markup): boolean {
  const style: ShapeStyle = {
    stroke: markup.style.stroke ?? DEFAULT_SHAPE_STYLE.stroke,
    ...(markup.style.fill && { fill: markup.style.fill }),
    ...(markup.style.fillOpacity !== undefined && { fillOpacity: markup.style.fillOpacity }),
    width: markup.style.width,
    opacity: markup.style.opacity,
    ...(markup.style.dash && { dash: markup.style.dash }),
    ...(markup.style.lineEnds && { lineEnds: markup.style.lineEnds }),
  };
  const g = markup.geometry;
  let shape: ShapeGeometry | undefined;
  if (markup.rawSubtype === 'Square' && g.kind === 'rect')
    shape = { kind: 'rectangle', rect: g.rect };
  else if (markup.rawSubtype === 'Circle' && g.kind === 'rect')
    shape = { kind: 'ellipse', rect: g.rect };
  else if (markup.rawSubtype === 'Line' && g.kind === 'line')
    shape = {
      kind: markup.intent === 'LineArrow' ? 'arrow' : 'line',
      start: g.points[0],
      end: g.points[1],
    };
  else if (markup.rawSubtype === 'PolyLine' && g.kind === 'poly')
    shape = { kind: 'polyline', points: g.points };
  else if (markup.rawSubtype === 'Polygon' && g.kind === 'poly')
    shape = { kind: 'polygon', points: g.points };
  else if (markup.rawSubtype === 'Ink' && g.kind === 'ink') shape = { kind: 'pen', paths: g.paths };
  if (!shape) return false;
  markup.rect = attach(doc.pdfDoc.context, markup.raw, shapeAppearance(shape, style), style);
  if (g.kind === 'rect') g.rect = markup.rect;
  return true;
}

/** Bounds helper for callers that need a shape's extent before it exists. */
export function shapeBounds(geometry: ShapeGeometry): Rect {
  switch (geometry.kind) {
    case 'rectangle':
    case 'ellipse':
      return geometry.rect;
    case 'line':
    case 'arrow':
      return boundsOf([geometry.start, geometry.end]);
    case 'polyline':
    case 'polygon':
      return boundsOf(geometry.points);
    case 'pen':
      return boundsOf(geometry.paths.flat());
  }
}
