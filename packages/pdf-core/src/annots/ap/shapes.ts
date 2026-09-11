/**
 * Appearance streams for plain shapes (PLAN §3.10 sales/review tools): rectangle,
 * ellipse, and pen (ink). Lines, polylines and polygons reuse the measurement builders in
 * `measurement.ts` without a caption.
 */

import type { Point, Rect, RGB } from '../../types.js';
import { boundsOf } from '../../measure/geometry.js';
import { ContentBuilder } from './content.js';
import { ALPHA_GS } from './form.js';
import type { AppearanceResult } from './measurement.js';

export interface RectAppearanceSpec {
  rect: Rect;
  stroke: RGB;
  fill?: RGB;
  width: number;
  dash?: number[];
  opacity: number;
  fillOpacity: number;
}

/** `/Square`: the rectangle is inset by half the stroke so the border stays inside `/Rect`. */
export function buildRectAppearance(spec: RectAppearanceSpec): AppearanceResult {
  const builder = new ContentBuilder();
  const [x0, y0, x1, y1] = spec.rect;
  const inset = spec.width / 2;

  builder.save();
  if (spec.opacity < 1 || spec.fillOpacity < 1) builder.extGState(ALPHA_GS);
  builder.strokeColor(spec.stroke).lineWidth(spec.width);
  if (spec.fill) builder.fillColor(spec.fill);
  if (spec.dash?.length) builder.dash(spec.dash);
  builder.rect(x0 + inset, y0 + inset, x1 - x0 - spec.width, y1 - y0 - spec.width);
  builder.push(spec.fill ? 'B' : 'S');
  builder.restore();

  return { content: builder.toString(), bounds: [x0, y0, x1, y1], withFont: false };
}

export interface EllipseAppearanceSpec {
  rect: Rect;
  stroke: RGB;
  fill?: RGB;
  width: number;
  dash?: number[];
  opacity: number;
  fillOpacity: number;
}

function fmt(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** `/Circle`: an ellipse inscribed in `/Rect` from four Bezier arcs. */
export function buildEllipseAppearance(spec: EllipseAppearanceSpec): AppearanceResult {
  const builder = new ContentBuilder();
  const [x0, y0, x1, y1] = spec.rect;
  const inset = spec.width / 2;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.max(0.1, (x1 - x0) / 2 - inset);
  const ry = Math.max(0.1, (y1 - y0) / 2 - inset);
  const kx = rx * 0.5523;
  const ky = ry * 0.5523;

  builder.save();
  if (spec.opacity < 1 || spec.fillOpacity < 1) builder.extGState(ALPHA_GS);
  builder.strokeColor(spec.stroke).lineWidth(spec.width);
  if (spec.fill) builder.fillColor(spec.fill);
  if (spec.dash?.length) builder.dash(spec.dash);
  builder
    .moveTo(cx + rx, cy)
    .push(
      `${fmt(cx + rx)} ${fmt(cy + ky)} ${fmt(cx + kx)} ${fmt(cy + ry)} ${fmt(cx)} ${fmt(cy + ry)} c`,
    )
    .push(
      `${fmt(cx - kx)} ${fmt(cy + ry)} ${fmt(cx - rx)} ${fmt(cy + ky)} ${fmt(cx - rx)} ${fmt(cy)} c`,
    )
    .push(
      `${fmt(cx - rx)} ${fmt(cy - ky)} ${fmt(cx - kx)} ${fmt(cy - ry)} ${fmt(cx)} ${fmt(cy - ry)} c`,
    )
    .push(
      `${fmt(cx + kx)} ${fmt(cy - ry)} ${fmt(cx + rx)} ${fmt(cy - ky)} ${fmt(cx + rx)} ${fmt(cy)} c`,
    )
    .closePath()
    .push(spec.fill ? 'B' : 'S');
  builder.restore();

  return { content: builder.toString(), bounds: [x0, y0, x1, y1], withFont: false };
}

export interface InkAppearanceSpec {
  paths: Point[][];
  stroke: RGB;
  width: number;
  opacity: number;
  /** Highlighter: multiply over the page (the ExtGState carries `/BM`). */
  blend?: 'Multiply';
}

/** `/Ink`: each path is a stroked polyline with round joins and caps (a pen stroke). */
export function buildInkAppearance(spec: InkAppearanceSpec): AppearanceResult {
  const builder = new ContentBuilder();
  const all = spec.paths.flat();

  builder.save();
  if (spec.opacity < 1 || spec.blend) builder.extGState(ALPHA_GS);
  builder.strokeColor(spec.stroke).lineWidth(spec.width).roundJoins();
  for (const path of spec.paths) {
    const [first, ...rest] = path;
    if (!first) continue;
    builder.moveTo(first.x, first.y);
    if (rest.length === 0) builder.lineTo(first.x, first.y); // a dot
    for (const p of rest) builder.lineTo(p.x, p.y);
    builder.stroke();
  }
  builder.restore();

  const pad = Math.max(spec.width, 1);
  return { content: builder.toString(), bounds: boundsOf(all, pad), withFont: false };
}

// ---------------------------------------------------------------------------
// Cloud

export interface CloudAppearanceSpec {
  points: Point[];
  stroke: RGB;
  fill?: RGB;
  width: number;
  opacity: number;
  fillOpacity: number;
  /** `/BE /I`: 0..2, Revu's default 1. */
  intensity: number;
}

/** Arc radius for a cloud border: bigger intensity, bigger scallops. */
export function cloudRadius(width: number, intensity: number): number {
  return Math.max(4, 3 * Math.max(width, 1)) * (0.5 + Math.max(0, Math.min(2, intensity)) / 2) * 2;
}

/** Signed area > 0 when the polygon winds counter-clockwise in PDF space (y up). */
function signedArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export interface CloudArc {
  center: Point;
  radius: number;
  /** Start and end angles in radians, drawn counter-clockwise from start to end. */
  start: number;
  end: number;
}

/**
 * The scallops of a cloud border: along each edge, semicircular arcs of `radius` that bulge
 * outward. Shared by the appearance stream (Beziers) and the canvas (polyline sampling).
 */
export function cloudArcs(points: Point[], radius: number): CloudArc[] {
  if (points.length < 2) return [];
  const ccw = signedArea(points) > 0;
  const arcs: CloudArc[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.round(len / (radius * 1.6)));
    const step = len / n;
    const ux = dx / len;
    const uy = dy / len;
    // Outward normal: right of the direction for CCW polygons, left for CW.
    const nx = ccw ? uy : -uy;
    const ny = ccw ? -ux : ux;
    const angle = Math.atan2(uy, ux);
    for (let k = 0; k < n; k += 1) {
      const cx = a.x + ux * step * (k + 0.5);
      const cy = a.y + uy * step * (k + 0.5);
      const r = Math.min(radius, step * 0.75);
      // A 200-degree arc from the trailing side to the leading side, bulging outward.
      const outward = Math.atan2(ny, nx);
      void angle;
      arcs.push({
        center: { x: cx, y: cy },
        radius: r,
        start: outward - Math.PI * 0.55,
        end: outward + Math.PI * 0.55,
      });
    }
  }
  return arcs;
}

/** Sample the cloud border into a dense polyline (for the canvas). */
export function cloudOutline(points: Point[], radius: number, perArc = 10): Point[] {
  const out: Point[] = [];
  for (const arc of cloudArcs(points, radius)) {
    for (let i = 0; i <= perArc; i += 1) {
      const t = arc.start + ((arc.end - arc.start) * i) / perArc;
      out.push({
        x: arc.center.x + arc.radius * Math.cos(t),
        y: arc.center.y + arc.radius * Math.sin(t),
      });
    }
  }
  return out;
}

/** Append a circular arc (counter-clockwise, start->end) as cubic Beziers. */
function arcPath(builder: ContentBuilder, arc: CloudArc, moveFirst: boolean): void {
  const total = arc.end - arc.start;
  const segments = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2)));
  const delta = total / segments;
  const k = (4 / 3) * Math.tan(delta / 4);
  let t = arc.start;
  const p0 = {
    x: arc.center.x + arc.radius * Math.cos(t),
    y: arc.center.y + arc.radius * Math.sin(t),
  };
  if (moveFirst) builder.moveTo(p0.x, p0.y);
  else builder.lineTo(p0.x, p0.y);
  for (let i = 0; i < segments; i += 1) {
    const t1 = t + delta;
    const c1 = {
      x: arc.center.x + arc.radius * (Math.cos(t) - k * Math.sin(t)),
      y: arc.center.y + arc.radius * (Math.sin(t) + k * Math.cos(t)),
    };
    const c2 = {
      x: arc.center.x + arc.radius * (Math.cos(t1) + k * Math.sin(t1)),
      y: arc.center.y + arc.radius * (Math.sin(t1) - k * Math.cos(t1)),
    };
    const p = {
      x: arc.center.x + arc.radius * Math.cos(t1),
      y: arc.center.y + arc.radius * Math.sin(t1),
    };
    builder.push(`${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p.x)} ${fmt(p.y)} c`);
    t = t1;
  }
}

/** `/Polygon` + `/IT /PolygonCloud`: the polygon is filled, the border is scalloped. */
export function buildCloudAppearance(spec: CloudAppearanceSpec): AppearanceResult {
  const builder = new ContentBuilder();
  const radius = cloudRadius(spec.width, spec.intensity);
  const arcs = cloudArcs(spec.points, radius);
  const outline = cloudOutline(spec.points, radius, 4);

  builder.save();
  if (spec.opacity < 1 || spec.fillOpacity < 1) builder.extGState(ALPHA_GS);
  builder.strokeColor(spec.stroke).lineWidth(spec.width).roundJoins();
  if (spec.fill) {
    builder.fillColor(spec.fill);
    const [first, ...rest] = spec.points;
    if (first) {
      builder.moveTo(first.x, first.y);
      for (const p of rest) builder.lineTo(p.x, p.y);
      builder.closePath().fill();
    }
  }
  arcs.forEach((arc, i) => arcPath(builder, arc, i === 0));
  builder.closePath().stroke();
  builder.restore();

  const pad = Math.max(spec.width, 1) + radius;
  return {
    content: builder.toString(),
    bounds: boundsOf([...spec.points, ...outline], pad),
    withFont: false,
  };
}
