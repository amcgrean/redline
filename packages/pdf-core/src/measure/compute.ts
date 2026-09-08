/**
 * Turn a markup's point geometry into world-unit quantities. PLAN §3.7 "Math".
 *
 * The conversion is: value in points x (world units per point), and for areas the
 * factor is squared. Verified against Revu — see `geometry.polygonArea`.
 */

import type { Markup, PageScale } from '../types.js';
import { polygonArea, polygonPerimeter, polylineLength } from './geometry.js';
import { worldUnitsPerPoint } from './units.js';

export interface Computed {
  length?: number;
  area?: number;
  perimeter?: number;
  count?: number;
}

/** Compute length/area/perimeter in the scale's world unit. */
export function computeMeasurement(markup: Markup, pageScale: PageScale): Computed {
  const perPoint = worldUnitsPerPoint(pageScale.scale);
  const { geometry } = markup;

  if (geometry.kind === 'line') {
    return { length: polylineLength(geometry.points) * perPoint };
  }
  if (geometry.kind === 'poly') {
    if (geometry.closed) {
      return {
        area: polygonArea(geometry.points) * perPoint * perPoint,
        perimeter: polygonPerimeter(geometry.points) * perPoint,
      };
    }
    return { length: polylineLength(geometry.points) * perPoint };
  }
  if (geometry.kind === 'rect') {
    const [x0, y0, x1, y1] = geometry.rect;
    const width = (x1 - x0) * perPoint;
    const height = (y1 - y0) * perPoint;
    return { area: width * height, perimeter: 2 * (width + height) };
  }
  return {};
}
