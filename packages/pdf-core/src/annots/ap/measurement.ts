/**
 * Appearance streams for length and area measurements. PLAN §3.6 + Appendix A.
 *
 * Geometry here is page user space, matching the identity `/Matrix` in `form.ts`.
 */

import type { LineEnding, Point, Rect, RGB } from '../../types.js';
import {
  boundsOf,
  distance,
  midpointAlong,
  polygonCentroid,
  unionRect,
} from '../../measure/geometry.js';
import { ContentBuilder, helveticaCapHeight, helveticaWidth } from './content.js';
import { ALPHA_GS, CAPTION_FONT } from './form.js';

/** Half-width / length of a line ending, as a multiple of the stroke width. */
const ENDING_SCALE = 4;
/** Gap between the drawn line and the caption baseline, in points. */
const CAPTION_GAP = 3;

export interface CaptionSpec {
  text: string;
  size: number;
  color: RGB;
}

export interface LineAppearanceSpec {
  /** The measured endpoints, i.e. `/L`. */
  start: Point;
  end: Point;
  stroke: RGB;
  width: number;
  dash?: number[];
  lineEnds: [LineEnding, LineEnding];
  /** `/LL` — perpendicular leader offset. Negative flips the side. */
  leaderLength: number;
  /** `/LLE` — how far the leader extends past the drawn line. */
  leaderExtension: number;
  opacity: number;
  caption?: CaptionSpec;
}

interface Vector {
  x: number;
  y: number;
}

function unit(from: Point, to: Point): Vector {
  const length = distance(from, to);
  if (length === 0) return { x: 1, y: 0 };
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/** Clockwise perpendicular when traversing start -> end, per the `/LL` sign convention. */
function clockwiseNormal(direction: Vector): Vector {
  return { x: direction.y, y: -direction.x };
}

function offset(point: Point, vector: Vector, amount: number): Point {
  return { x: point.x + vector.x * amount, y: point.y + vector.y * amount };
}

/**
 * Draw one line ending at `tip`, pointing along `direction` (which points OUT of the
 * line, i.e. away from the other endpoint). Returns the points it touched so the caller
 * can grow the bounding box.
 */
function drawLineEnding(
  builder: ContentBuilder,
  ending: LineEnding,
  tip: Point,
  direction: Vector,
  width: number,
): Point[] {
  const size = Math.max(width, 0.5) * ENDING_SCALE;
  const normal = clockwiseNormal(direction);
  const back = offset(tip, direction, -size);

  switch (ending) {
    case 'None':
      return [tip];
    case 'ClosedArrow':
    case 'RClosedArrow': {
      const flip = ending === 'RClosedArrow' ? -1 : 1;
      const t = flip === 1 ? tip : offset(tip, direction, -size);
      const b = flip === 1 ? back : tip;
      const nl = offset(b, normal, size / 2);
      const nr = offset(b, normal, -size / 2);
      builder.moveTo(t.x, t.y).lineTo(nl.x, nl.y).lineTo(nr.x, nr.y).closePath().fillAndStroke();
      return [t, nl, nr];
    }
    case 'OpenArrow':
    case 'ROpenArrow': {
      const flip = ending === 'ROpenArrow' ? -1 : 1;
      const t = flip === 1 ? tip : offset(tip, direction, -size);
      const b = flip === 1 ? back : tip;
      const nl = offset(b, normal, size / 2);
      const nr = offset(b, normal, -size / 2);
      builder.moveTo(nl.x, nl.y).lineTo(t.x, t.y).lineTo(nr.x, nr.y).stroke();
      return [t, nl, nr];
    }
    case 'Butt': {
      const a = offset(tip, normal, size / 2);
      const b = offset(tip, normal, -size / 2);
      builder.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke();
      return [a, b];
    }
    case 'Slash': {
      // Revu's default measurement ending: a 60-degree tick through the endpoint.
      const angle = Math.PI / 3;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const slash: Vector = {
        x: direction.x * cos - direction.y * sin,
        y: direction.x * sin + direction.y * cos,
      };
      const a = offset(tip, slash, size / 2);
      const b = offset(tip, slash, -size / 2);
      builder.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke();
      return [a, b];
    }
    case 'Square': {
      const half = size / 2;
      builder.rect(tip.x - half, tip.y - half, size, size).fillAndStroke();
      return [
        { x: tip.x - half, y: tip.y - half },
        { x: tip.x + half, y: tip.y + half },
      ];
    }
    case 'Diamond': {
      const half = size / 2;
      builder
        .moveTo(tip.x, tip.y + half)
        .lineTo(tip.x + half, tip.y)
        .lineTo(tip.x, tip.y - half)
        .lineTo(tip.x - half, tip.y)
        .closePath()
        .fillAndStroke();
      return [
        { x: tip.x - half, y: tip.y - half },
        { x: tip.x + half, y: tip.y + half },
      ];
    }
    case 'Circle': {
      const r = size / 2;
      // Four Bezier arcs; 0.5523 is the standard circle-from-cubics constant.
      const k = r * 0.5523;
      builder
        .moveTo(tip.x + r, tip.y)
        .push(
          `${fmt(tip.x + r)} ${fmt(tip.y + k)} ${fmt(tip.x + k)} ${fmt(tip.y + r)} ${fmt(tip.x)} ${fmt(tip.y + r)} c`,
        )
        .push(
          `${fmt(tip.x - k)} ${fmt(tip.y + r)} ${fmt(tip.x - r)} ${fmt(tip.y + k)} ${fmt(tip.x - r)} ${fmt(tip.y)} c`,
        )
        .push(
          `${fmt(tip.x - r)} ${fmt(tip.y - k)} ${fmt(tip.x - k)} ${fmt(tip.y - r)} ${fmt(tip.x)} ${fmt(tip.y - r)} c`,
        )
        .push(
          `${fmt(tip.x + k)} ${fmt(tip.y - r)} ${fmt(tip.x + r)} ${fmt(tip.y - k)} ${fmt(tip.x + r)} ${fmt(tip.y)} c`,
        )
        .fillAndStroke();
      return [
        { x: tip.x - r, y: tip.y - r },
        { x: tip.x + r, y: tip.y + r },
      ];
    }
    default:
      return [tip];
  }
}

function fmt(value: number): string {
  return String(Number(value.toFixed(6)));
}

export interface AppearanceResult {
  content: string;
  /** Bounds of everything drawn, before the caller pads it into `/Rect`. */
  bounds: Rect;
  withFont: boolean;
}

/**
 * Length measurement appearance: leader lines, the offset measured line, line endings and
 * a horizontal Helvetica caption above the line's midpoint.
 */
export function buildLineAppearance(spec: LineAppearanceSpec): AppearanceResult {
  const builder = new ContentBuilder();
  const direction = unit(spec.start, spec.end);
  const normal = clockwiseNormal(direction);

  // `/LL` offsets the drawn line perpendicular to the measured endpoints.
  const lineStart = offset(spec.start, normal, spec.leaderLength);
  const lineEnd = offset(spec.end, normal, spec.leaderLength);
  const touched: Point[] = [spec.start, spec.end, lineStart, lineEnd];

  builder.save();
  if (spec.opacity < 1) builder.extGState(ALPHA_GS);
  builder.strokeColor(spec.stroke).fillColor(spec.stroke).lineWidth(spec.width).roundJoins();
  if (spec.dash?.length) builder.dash(spec.dash);

  // Leader lines run from the measured point, past the drawn line, by `/LLE`.
  if (spec.leaderLength !== 0) {
    const sign = Math.sign(spec.leaderLength) || 1;
    const extension = spec.leaderLength + sign * spec.leaderExtension;
    for (const anchor of [spec.start, spec.end]) {
      const far = offset(anchor, normal, extension);
      builder.moveTo(anchor.x, anchor.y).lineTo(far.x, far.y).stroke();
      touched.push(far);
    }
  }

  builder.moveTo(lineStart.x, lineStart.y).lineTo(lineEnd.x, lineEnd.y).stroke();

  // Endings are drawn solid even when the line is dashed.
  if (spec.dash?.length) builder.dash([]);
  touched.push(
    ...drawLineEnding(
      builder,
      spec.lineEnds[0],
      lineStart,
      { x: -direction.x, y: -direction.y },
      spec.width,
    ),
    ...drawLineEnding(builder, spec.lineEnds[1], lineEnd, direction, spec.width),
  );

  if (spec.caption && spec.caption.text) {
    const { text, size, color } = spec.caption;
    const mid = { x: (lineStart.x + lineEnd.x) / 2, y: (lineStart.y + lineEnd.y) / 2 };
    const textWidth = helveticaWidth(text, size);
    // `/CP /Top`: sit the caption on the side the leader lines point away from.
    const side = spec.leaderLength >= 0 ? -1 : 1;
    const baseline = offset(mid, normal, side * (CAPTION_GAP + spec.width));
    const x = baseline.x - textWidth / 2;
    const y =
      side < 0 ? baseline.y - helveticaCapHeight(size) - CAPTION_GAP : baseline.y + CAPTION_GAP;
    builder.fillColor(color).text(CAPTION_FONT, size, x, y, text);
    touched.push({ x, y: y - size * 0.25 }, { x: x + textWidth, y: y + helveticaCapHeight(size) });
  }

  builder.restore();
  const pad = Math.max(spec.width, 1) * (ENDING_SCALE / 2 + 1);
  return {
    content: builder.toString(),
    bounds: boundsOf(touched, pad),
    withFont: Boolean(spec.caption?.text),
  };
}

export interface PolygonAppearanceSpec {
  points: Point[];
  stroke: RGB;
  fill?: RGB;
  width: number;
  dash?: number[];
  opacity: number;
  fillOpacity: number;
  caption?: CaptionSpec;
}

/** Area measurement appearance: filled + stroked polygon with a caption at the centroid. */
export function buildPolygonAppearance(spec: PolygonAppearanceSpec): AppearanceResult {
  const builder = new ContentBuilder();
  const touched: Point[] = [...spec.points];

  builder.save();
  if (spec.opacity < 1 || spec.fillOpacity < 1) builder.extGState(ALPHA_GS);
  builder.strokeColor(spec.stroke).lineWidth(spec.width).roundJoins();
  if (spec.fill) builder.fillColor(spec.fill);
  if (spec.dash?.length) builder.dash(spec.dash);

  const [first, ...rest] = spec.points;
  if (first) {
    builder.moveTo(first.x, first.y);
    for (const point of rest) builder.lineTo(point.x, point.y);
    builder.closePath();
    builder.push(spec.fill ? 'B' : 'S');
  }

  if (spec.caption && spec.caption.text) {
    const { text, size, color } = spec.caption;
    const centre = polygonCentroid(spec.points);
    const textWidth = helveticaWidth(text, size);
    const x = centre.x - textWidth / 2;
    const y = centre.y - helveticaCapHeight(size) / 2;
    // The caption is opaque even when the fill is not, so the number stays readable.
    builder.restore().save().fillColor(color).text(CAPTION_FONT, size, x, y, text);
    touched.push({ x, y: y - size * 0.25 }, { x: x + textWidth, y: y + helveticaCapHeight(size) });
  }

  builder.restore();
  const pad = Math.max(spec.width, 1) * 1.5;
  return {
    content: builder.toString(),
    bounds: boundsOf(touched, pad),
    withFont: Boolean(spec.caption?.text),
  };
}

export interface PolylineAppearanceSpec {
  /** `/Vertices`. A perimeter repeats its first vertex at the end. */
  points: Point[];
  stroke: RGB;
  width: number;
  dash?: number[];
  lineEnds: [LineEnding, LineEnding];
  opacity: number;
  caption?: CaptionSpec;
}

/**
 * Polylength / perimeter appearance: an open stroked run, optional endings on the first
 * and last vertex, and a caption just above the midpoint of the path.
 */
export function buildPolylineAppearance(spec: PolylineAppearanceSpec): AppearanceResult {
  const builder = new ContentBuilder();
  const touched: Point[] = [...spec.points];

  builder.save();
  if (spec.opacity < 1) builder.extGState(ALPHA_GS);
  builder.strokeColor(spec.stroke).fillColor(spec.stroke).lineWidth(spec.width).roundJoins();
  if (spec.dash?.length) builder.dash(spec.dash);

  const [first, ...rest] = spec.points;
  if (first) {
    builder.moveTo(first.x, first.y);
    for (const point of rest) builder.lineTo(point.x, point.y);
    builder.stroke();
  }

  if (spec.dash?.length) builder.dash([]);
  const n = spec.points.length;
  if (n >= 2) {
    const p0 = spec.points[0]!;
    const p1 = spec.points[1]!;
    const pn = spec.points[n - 1]!;
    const pm = spec.points[n - 2]!;
    touched.push(
      ...drawLineEnding(builder, spec.lineEnds[0], p0, unit(p1, p0), spec.width),
      ...drawLineEnding(builder, spec.lineEnds[1], pn, unit(pm, pn), spec.width),
    );
  }

  if (spec.caption && spec.caption.text) {
    const { text, size, color } = spec.caption;
    const mid = midpointAlong(spec.points);
    const textWidth = helveticaWidth(text, size);
    const x = mid.x - textWidth / 2;
    const y = mid.y + CAPTION_GAP + spec.width;
    builder.fillColor(color).text(CAPTION_FONT, size, x, y, text);
    touched.push({ x, y: y - size * 0.25 }, { x: x + textWidth, y: y + helveticaCapHeight(size) });
  }

  builder.restore();
  const pad = Math.max(spec.width, 1) * (ENDING_SCALE / 2 + 1);
  return {
    content: builder.toString(),
    bounds: boundsOf(touched, pad),
    withFont: Boolean(spec.caption?.text),
  };
}

/** Grow `rect` so it contains `other`. Re-exported for callers building `/Rect`. */
export { unionRect };
