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
}

/** `/Ink`: each path is a stroked polyline with round joins and caps (a pen stroke). */
export function buildInkAppearance(spec: InkAppearanceSpec): AppearanceResult {
  const builder = new ContentBuilder();
  const all = spec.paths.flat();

  builder.save();
  if (spec.opacity < 1) builder.extGState(ALPHA_GS);
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
