/** Pure geometry in PDF user space (points). PLAN §3.7 "Math". */

export interface Point {
  x: number;
  y: number;
}

export type Rect = [x0: number, y0: number, x1: number, y1: number];

/** Flat `[x0,y0,x1,y1,...]` (the shape of `/L`, `/Vertices`) -> points. */
export function toPoints(flat: readonly number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i]!, y: flat[i + 1]! });
  return out;
}

export function fromPoints(points: readonly Point[]): number[] {
  return points.flatMap((p) => [p.x, p.y]);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Total length of an open polyline. A two-point run is a plain line length. */
export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1]!, points[i]!);
  return total;
}

/** Perimeter of a closed polygon (includes the closing segment). */
export function polygonPerimeter(points: readonly Point[]): number {
  if (points.length < 2) return 0;
  return polylineLength(points) + distance(points[points.length - 1]!, points[0]!);
}

/**
 * Shoelace area, always positive so winding direction does not matter.
 *
 * Verified against Revu: the fixture's 14-vertex `/Polygon` gives 702814.907 pt²,
 * which at 0.05555556 ft/pt is 2169.18 sf — and Revu's own `/Contents` reads `2,169 sf`.
 */
export function polygonArea(points: readonly Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Axis-aligned bounds of a point set, grown by `pad` on every side. */
export function boundsOf(points: readonly Point[], pad = 0): Rect {
  if (points.length === 0) return [0, 0, 0, 0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

/** Union of two rects. */
export function unionRect(a: Rect, b: Rect): Rect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function translatePoints(points: readonly Point[], dx: number, dy: number): Point[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function translateRect(rect: Rect, dx: number, dy: number): Rect {
  return [rect[0] + dx, rect[1] + dy, rect[2] + dx, rect[3] + dy];
}

/** Midpoint of a polyline measured along its length — where a caption sits. */
export function midpointAlong(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const half = polylineLength(points) / 2;
  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = distance(a, b);
    if (travelled + seg >= half) {
      const t = seg === 0 ? 0 : (half - travelled) / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    travelled += seg;
  }
  return points[points.length - 1]!;
}

/** Centroid of a polygon (area-weighted), used to place area captions. */
export function polygonCentroid(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length < 3) return midpointAlong(points);
  let cx = 0;
  let cy = 0;
  let signed = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const cross = a.x * b.y - b.x * a.y;
    signed += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (signed === 0) {
    const bounds = boundsOf(points);
    return { x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2 };
  }
  return { x: cx / (3 * signed), y: cy / (3 * signed) };
}
