/**
 * Snapping and constraints (PLAN §3.3): endpoints, midpoints and corners of existing
 * markups, Shift for orthogonal / 45° from the previous vertex, Alt to override. Pure
 * functions in PDF user space; the layer decides the pixel tolerance.
 */

import type { Markup, Point } from '@redline/pdf-core';

export interface SnapCandidate {
  point: Point;
  kind: 'end' | 'mid' | 'corner' | 'center';
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Endpoints and midpoints of every segment, corners and centres of every box. */
export function snapCandidates(markups: readonly Markup[], excludeId?: string): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (const m of markups) {
    if (m.id === excludeId || m.flags.hidden) continue;
    const g = m.geometry;
    if (g.kind === 'line' || g.kind === 'poly') {
      const pts = g.points;
      pts.forEach((p) => out.push({ point: p, kind: 'end' }));
      const n = g.kind === 'poly' && g.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i += 1) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        if (a.x === b.x && a.y === b.y) continue;
        out.push({ point: mid(a, b), kind: 'mid' });
      }
    } else if (g.kind === 'rect') {
      const [x0, y0, x1, y1] = g.rect;
      const corners: Point[] = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
      corners.forEach((p) => out.push({ point: p, kind: 'corner' }));
      for (let i = 0; i < 4; i += 1) {
        out.push({ point: mid(corners[i]!, corners[(i + 1) % 4]!), kind: 'mid' });
      }
      out.push({ point: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, kind: 'center' });
    }
  }
  return out;
}

/** The nearest candidate within `tolerance` (user-space units), else undefined. */
export function nearestCandidate(
  p: Point,
  candidates: readonly SnapCandidate[],
  tolerance: number,
): SnapCandidate | undefined {
  let best: SnapCandidate | undefined;
  let bestDistance = tolerance;
  for (const c of candidates) {
    const d = Math.hypot(c.point.x - p.x, c.point.y - p.y);
    if (d <= bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

/** Shift: keep the segment from `anchor` on the nearest multiple of `step` (45° by default). */
export function constrainAngle(anchor: Point, p: Point, step = Math.PI / 4): Point {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return p;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  // Project onto the constrained direction so the length along it is preserved.
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const t = dx * ux + dy * uy;
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return { x: round(anchor.x + t * ux), y: round(anchor.y + t * uy) };
}

/** Shift while dragging a box: a square (or circle), keeping the larger extent. */
export function constrainSquare(anchor: Point, p: Point): Point {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: anchor.x + Math.sign(dx || 1) * size, y: anchor.y + Math.sign(dy || 1) * size };
}
