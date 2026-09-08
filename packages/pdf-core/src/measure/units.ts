/** Scale and unit types. PLAN §3.7. */

export type PageUnit = 'in' | 'mm';
export type WorldUnit = 'ft' | 'in' | 'm' | 'mm' | 'cm' | 'yd';

/** A page-length : world-length ratio, e.g. 0.25 in = 1 ft. */
export interface Scale {
  pageLength: number;
  pageUnit: PageUnit;
  worldLength: number;
  worldUnit: WorldUnit;
}

export type DisplayFormat = 'ft-in' | 'decimal-ft' | 'in' | 'm' | 'mm' | 'cm';

/**
 * How a value is rendered. For `ft-in` and `in`, `precision` is a fraction
 * denominator (16 => 1/16"). For the decimal formats it is a count of decimal places.
 */
export interface UnitFormat {
  display: DisplayFormat;
  precision: number;
}

/** Points per page unit. PDF user space is 1/72 in. */
const POINTS_PER: Record<PageUnit, number> = {
  in: 72,
  mm: 72 / 25.4,
};

/** Metres per world unit — the pivot for converting between world units. */
const METRES_PER: Record<WorldUnit, number> = {
  ft: 0.3048,
  in: 0.0254,
  m: 1,
  mm: 0.001,
  cm: 0.01,
  yd: 0.9144,
};

/**
 * World units per PDF point for a scale.
 *
 * Verified against Revu: `0.25 in = 1 ft` yields `/C 0.05555556` in the fixture's
 * `/Measure /X` array, and 4/72 = 0.0555555… ✓
 */
export function worldUnitsPerPoint(scale: Scale): number {
  const pointsPerPageUnit = POINTS_PER[scale.pageUnit];
  if (scale.pageLength <= 0) throw new RangeError('scale.pageLength must be > 0');
  if (scale.worldLength <= 0) throw new RangeError('scale.worldLength must be > 0');
  return scale.worldLength / (scale.pageLength * pointsPerPageUnit);
}

/** Convert a value between world units. */
export function convertWorld(value: number, from: WorldUnit, to: WorldUnit): number {
  return (value * METRES_PER[from]) / METRES_PER[to];
}

/** The world unit a display format reports in. */
export function displayUnit(display: DisplayFormat): WorldUnit {
  switch (display) {
    case 'ft-in':
    case 'decimal-ft':
      return 'ft';
    case 'in':
      return 'in';
    case 'm':
      return 'm';
    case 'mm':
      return 'mm';
    case 'cm':
      return 'cm';
  }
}

/** Short label for area totals, e.g. `sf` for feet. Matches Revu's `/A /U (sf)`. */
export function areaUnitLabel(display: DisplayFormat): string {
  switch (display) {
    case 'ft-in':
    case 'decimal-ft':
      return 'sf';
    case 'in':
      return 'sq in';
    case 'm':
      return 'sq m';
    case 'mm':
      return 'sq mm';
    case 'cm':
      return 'sq cm';
  }
}
