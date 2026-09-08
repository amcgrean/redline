import { describe, expect, it } from 'vitest';
import {
  formatArea,
  formatDecimal,
  formatFeetInches,
  formatInches,
  formatLength,
  scaleRatioString,
  splitInchFraction,
} from '../src/measure/format.js';
import { convertWorld, worldUnitsPerPoint } from '../src/measure/units.js';
import { polygonArea, polylineLength, toPoints } from '../src/measure/geometry.js';

describe('feet-inches formatter', () => {
  it('formats whole feet with a zero-inch tail', () => {
    expect(formatFeetInches(80)).toBe(`80'-0"`);
  });

  it('formats inches and reduced fractions', () => {
    expect(formatFeetInches(16 + 1.5 / 12)).toBe(`16'-1 1/2"`);
    expect(formatFeetInches(3 + 0.25 / 12)).toBe(`3'-0 1/4"`);
    expect(formatFeetInches(3 + 0.125 / 12)).toBe(`3'-0 1/8"`);
    expect(formatFeetInches(3 + 0.0625 / 12)).toBe(`3'-0 1/16"`);
  });

  it('rounds to the requested denominator', () => {
    expect(formatFeetInches(1 + 0.03 / 12, 16)).toBe(`1'-0"`);
    expect(formatFeetInches(1 + 0.04 / 12, 16)).toBe(`1'-0 1/16"`);
    expect(formatFeetInches(1 + 0.4 / 12, 1)).toBe(`1'-0"`);
    expect(formatFeetInches(1 + 0.6 / 12, 1)).toBe(`1'-1"`);
  });

  it('carries a rounded-up 12" into the next foot', () => {
    expect(formatFeetInches(1 + 11.99 / 12, 16)).toBe(`2'-0"`);
    expect(formatFeetInches(1 + (11 + 31 / 32) / 12, 16)).toBe(`2'-0"`);
  });

  it('groups thousands in the feet part', () => {
    expect(formatFeetInches(1234.5)).toBe(`1,234'-6"`);
  });

  it('handles negatives and zero', () => {
    expect(formatFeetInches(0)).toBe(`0'-0"`);
    expect(formatFeetInches(-2.5)).toBe(`-2'-6"`);
  });

  it('splits inch fractions in lowest terms', () => {
    expect(splitInchFraction(1.5, 16)).toEqual({ whole: 1, numerator: 1, denominator: 2 });
    expect(splitInchFraction(0.9375, 16)).toEqual({ whole: 0, numerator: 15, denominator: 16 });
    expect(splitInchFraction(2, 16)).toEqual({ whole: 2, numerator: 0, denominator: 1 });
  });
});

describe('other formats', () => {
  it('formats plain inches', () => {
    expect(formatInches(13.5)).toBe(`13 1/2"`);
    expect(formatInches(0.0625)).toBe(`0 1/16"`);
  });

  it('formats decimals with grouping and no negative zero', () => {
    expect(formatDecimal(2169.18, 0)).toBe('2,169');
    expect(formatDecimal(2169.18, 2)).toBe('2,169.18');
    expect(formatDecimal(-0.001, 2)).toBe('0.00');
  });

  it('formatLength converts into the display unit', () => {
    expect(formatLength(23.8333, { display: 'ft-in', precision: 16 })).toBe(`23'-10"`);
    expect(formatLength(23.8333, { display: 'decimal-ft', precision: 2 })).toBe(`23.83'`);
    expect(formatLength(1, { display: 'in', precision: 16 })).toBe(`12"`);
    expect(formatLength(1, { display: 'm', precision: 3 })).toBe('0.305 m');
    expect(formatLength(1, { display: 'mm', precision: 0 })).toBe('305 mm');
  });

  it('formatArea squares the conversion', () => {
    expect(formatArea(2169.18, { display: 'ft-in', precision: 16 })).toBe('2,169 sf');
    expect(formatArea(2169.18, { display: 'ft-in', precision: 16 }, 'ft', 1)).toBe('2,169.2 sf');
    expect(formatArea(1, { display: 'in', precision: 16 })).toBe('144 sq in');
  });

  it('writes the /R scale string the way Revu does', () => {
    expect(scaleRatioString(0.25, 'in', 1, 'ft', 'ft-in')).toBe(`0.25 in = 1 ft' in"`);
    expect(scaleRatioString(1, 'in', 8, 'ft', 'decimal-ft')).toBe('1 in = 8 ft');
  });
});

describe('scale math', () => {
  it('matches the /C Revu wrote for 0.25 in = 1 ft', () => {
    const perPoint = worldUnitsPerPoint({
      pageLength: 0.25,
      pageUnit: 'in',
      worldLength: 1,
      worldUnit: 'ft',
    });
    expect(perPoint).toBeCloseTo(0.05555556, 7);
  });

  it('matches PLAN Appendix A for 1/8 in = 1 ft', () => {
    const perPoint = worldUnitsPerPoint({
      pageLength: 0.125,
      pageUnit: 'in',
      worldLength: 1,
      worldUnit: 'ft',
    });
    expect(perPoint).toBeCloseTo(0.1111111, 6);
  });

  it('converts between world units through metres', () => {
    expect(convertWorld(1, 'ft', 'in')).toBeCloseTo(12);
    expect(convertWorld(1, 'm', 'mm')).toBeCloseTo(1000);
    expect(convertWorld(3, 'yd', 'ft')).toBeCloseTo(9);
  });
});

/**
 * Ground truth decoded from `fixtures/Takeoff bluebeam copy 16228 Sharon Drive - Urbandale.pdf`:
 * object 128 (`/Line`, `/Contents(23'-10")`) and object 322 (`/Polygon`, `/Contents(2,169 sf)`),
 * both at 0.25 in = 1 ft.
 */
describe('reproduces Revu 21 captions from its own geometry', () => {
  const REVU_SCALE = { pageLength: 0.25, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
  const perPoint = worldUnitsPerPoint(REVU_SCALE);

  it('line 128: 429 pt at 1/4" = 1\' reads 23\'-10"', () => {
    const points = toPoints([1209.507, 901.4037, 1209.507, 1330.404]);
    const feet = polylineLength(points) * perPoint;
    expect(formatLength(feet, { display: 'ft-in', precision: 1 })).toBe(`23'-10"`);
    expect(formatLength(feet, { display: 'ft-in', precision: 16 })).toBe(`23'-10"`);
  });

  it('polygon 322: shoelace area reads 2,169 sf', () => {
    const points = toPoints([
      654.5067, 352.4039, 654.5067, 376.4038, 588.5067, 376.4038, 588.5066, 1276.404, 858.5067,
      1276.404, 858.5067, 1330.404, 1488.507, 1330.404, 1488.507, 670.4038, 1026.507, 670.4038,
      1026.507, 431.9037, 867.5067, 433.7203, 867.5066, 374.4849, 801.5067, 376.4037, 801.5067,
      352.4038,
    ]);
    const sf = polygonArea(points) * perPoint * perPoint;
    expect(sf).toBeCloseTo(2169.18, 1);
    expect(formatArea(sf, { display: 'ft-in', precision: 1 })).toBe('2,169 sf');
  });
});
