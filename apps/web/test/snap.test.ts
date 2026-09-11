import { describe, expect, it } from 'vitest';
import type { Markup } from '@redline/pdf-core';
import { constrainAngle, constrainSquare, nearestCandidate, snapCandidates } from '../src/snap';

function fake(geometry: Markup['geometry'], id = 'A'): Markup {
  return { id, geometry, flags: { hidden: false, locked: false, print: true } } as Markup;
}

const LINE = fake({
  kind: 'line',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
});

describe('snapCandidates', () => {
  it('lists endpoints and midpoints of a line', () => {
    expect(snapCandidates([LINE]).map((x) => [x.kind, x.point.x])).toEqual([
      ['end', 0],
      ['end', 10],
      ['mid', 5],
    ]);
  });

  it('adds the closing segment midpoint for a closed poly and skips the excluded markup', () => {
    const tri = fake(
      {
        kind: 'poly',
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 0, y: 4 },
        ],
      },
      'T',
    );
    expect(snapCandidates([tri]).filter((c) => c.kind === 'mid')).toHaveLength(3);
    expect(snapCandidates([tri], 'T')).toHaveLength(0);
  });

  it('gives a rect its corners, edge midpoints and centre', () => {
    const c = snapCandidates([fake({ kind: 'rect', rect: [0, 0, 10, 20] })]);
    expect(c).toHaveLength(9);
    expect(c.find((x) => x.kind === 'center')?.point).toEqual({ x: 5, y: 10 });
  });
});

describe('nearestCandidate', () => {
  it('returns the closest within tolerance, else undefined', () => {
    const cands = snapCandidates([LINE]);
    expect(nearestCandidate({ x: 5.4, y: 0.3 }, cands, 1)?.point).toEqual({ x: 5, y: 0 });
    expect(nearestCandidate({ x: 7.5, y: 0 }, cands, 1)).toBeUndefined();
  });
});

describe('constrainAngle', () => {
  it('snaps a nearly horizontal segment to horizontal, keeping its projected length', () => {
    expect(constrainAngle({ x: 0, y: 0 }, { x: 100, y: 3 })).toEqual({ x: 100, y: 0 });
  });
  it('snaps to 45°', () => {
    const p = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 8 });
    expect(p.x).toBeCloseTo(9, 6);
    expect(p.y).toBeCloseTo(9, 6);
  });
  it('snaps to vertical and leaves a zero-length segment alone', () => {
    expect(constrainAngle({ x: 5, y: 5 }, { x: 4, y: -50 })).toEqual({ x: 5, y: -50 });
    expect(constrainAngle({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });
});

describe('constrainSquare', () => {
  it('keeps the larger extent and the drag direction', () => {
    expect(constrainSquare({ x: 0, y: 0 }, { x: 30, y: -10 })).toEqual({ x: 30, y: -30 });
    expect(constrainSquare({ x: 10, y: 10 }, { x: 0, y: 40 })).toEqual({ x: -20, y: 40 });
  });
});
