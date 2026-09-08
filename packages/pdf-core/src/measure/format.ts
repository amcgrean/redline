/**
 * Feet-inches (and friends) formatting. CLAUDE.md: this file is the single source of
 * truth for captions AND for the `/Measure` `/D` arrays — nothing else may format a
 * measurement value.
 *
 * Verified against Revu 21 output in
 * `fixtures/Takeoff bluebeam copy 16228 Sharon Drive - Urbandale.pdf`:
 *   - a `/Line` of 429.0004 pt at 0.25 in = 1 ft carries `/Contents(23'-10")`
 *   - a `/Polygon` whose shoelace area is 2169.18 sf carries `/Contents(2,169 sf)`
 * So: `<feet>'-<inches>"` with a hyphen separator, and thousands-grouped areas.
 */

import type { DisplayFormat, UnitFormat, WorldUnit } from './units.js';
import { areaUnitLabel, convertWorld, displayUnit } from './units.js';

/** Fraction denominators offered for ft-in / inches display. */
export const FRACTION_DENOMINATORS = [1, 2, 4, 8, 16, 32, 64] as const;

function greatestCommonDivisor(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** `12345.6` -> `12,345.6`. Revu groups thousands in area captions. */
function groupThousands(text: string): string {
  const [whole = '', fraction] = text.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? `${sign}${grouped}` : `${sign}${grouped}.${fraction}`;
}

/**
 * Split a signed inch value into whole inches plus a reduced fraction, rounded to
 * `1/denominator`. Carries into the next inch when rounding reaches a whole.
 */
export function splitInchFraction(
  inches: number,
  denominator: number,
): { whole: number; numerator: number; denominator: number } {
  const ticks = Math.round(inches * denominator);
  const whole = Math.trunc(ticks / denominator);
  let numerator = ticks - whole * denominator;
  let den = denominator;
  if (numerator === 0) return { whole, numerator: 0, denominator: 1 };
  const divisor = greatestCommonDivisor(Math.abs(numerator), den);
  numerator /= divisor;
  den /= divisor;
  return { whole, numerator, denominator: den };
}

/**
 * Format a length in feet as architectural feet-inches: `80'-0"`, `23'-10"`,
 * `16'-1 1/2"`. `denominator` is the fraction precision (16 => nearest 1/16").
 */
export function formatFeetInches(feet: number, denominator = 16): string {
  const negative = feet < 0;
  const magnitude = Math.abs(feet);

  const totalInches = magnitude * 12;
  const ticksPerFoot = 12 * denominator;
  const totalTicks = Math.round(totalInches * denominator);

  let wholeFeet = Math.floor(totalTicks / ticksPerFoot);
  const remainderTicks = totalTicks - wholeFeet * ticksPerFoot;

  const {
    whole: wholeInches,
    numerator,
    denominator: den,
  } = splitInchFraction(remainderTicks / denominator, denominator);
  // splitInchFraction cannot carry past 12" here (remainderTicks < ticksPerFoot),
  // but guard so a future precision change can't produce `5'-12"`.
  let inches = wholeInches;
  if (inches >= 12) {
    wholeFeet += Math.floor(inches / 12);
    inches %= 12;
  }

  const inchText = numerator ? `${inches} ${numerator}/${den}` : `${inches}`;
  return `${negative ? '-' : ''}${groupThousands(String(wholeFeet))}'-${inchText}"`;
}

/** Format a length in inches as `13 1/2"`. */
export function formatInches(inches: number, denominator = 16): string {
  const negative = inches < 0;
  const { whole, numerator, denominator: den } = splitInchFraction(Math.abs(inches), denominator);
  const text = numerator
    ? `${groupThousands(String(whole))} ${numerator}/${den}`
    : `${groupThousands(String(whole))}`;
  return `${negative ? '-' : ''}${text}"`;
}

/** Fixed-decimal number with thousands grouping, e.g. `2,169.18`. */
export function formatDecimal(value: number, decimals: number): string {
  // toFixed(-0.001, 2) === "-0.00"; normalise the sign so captions never read `-0.00`.
  const fixed = value.toFixed(Math.max(0, Math.trunc(decimals)));
  return groupThousands(Number(fixed) === 0 ? fixed.replace('-', '') : fixed);
}

/**
 * Format a length. `value` is in the world unit of `scaleWorldUnit`; it is converted
 * into the unit implied by `format.display` before rendering.
 */
export function formatLength(
  value: number,
  format: UnitFormat,
  scaleWorldUnit: WorldUnit = 'ft',
): string {
  const target = displayUnit(format.display);
  const converted = convertWorld(value, scaleWorldUnit, target);
  switch (format.display) {
    case 'ft-in':
      return formatFeetInches(converted, format.precision);
    case 'in':
      return formatInches(converted, format.precision);
    case 'decimal-ft':
      return `${formatDecimal(converted, format.precision)}'`;
    case 'm':
    case 'mm':
    case 'cm':
      return `${formatDecimal(converted, format.precision)} ${target}`;
  }
}

/**
 * Format an area. `value` is in squared `scaleWorldUnit`. Revu writes whole square feet
 * with thousands grouping (`2,169 sf`), which is `areaDecimals: 0`.
 */
export function formatArea(
  value: number,
  format: UnitFormat,
  scaleWorldUnit: WorldUnit = 'ft',
  areaDecimals = 0,
): string {
  const target = displayUnit(format.display);
  const linear = convertWorld(1, scaleWorldUnit, target);
  const converted = value * linear * linear;
  return `${formatDecimal(converted, areaDecimals)} ${areaUnitLabel(format.display)}`;
}

/**
 * The `/R` scale string Revu writes, e.g. `0.25 in = 1 ft' in"`.
 * Verified: the fixture's `/Measure` carries `/R(0.25 in = 1 ft' in")` for a
 * 1/4" = 1'-0" page in feet-inches display. The trailing `' in"` is Revu's suffix for
 * feet-inches display; decimal displays omit it.
 */
export function scaleRatioString(
  pageLength: number,
  pageUnit: string,
  worldLength: number,
  worldUnit: WorldUnit,
  display: DisplayFormat,
): string {
  const base = `${trimNumber(pageLength)} ${pageUnit} = ${trimNumber(worldLength)} ${worldUnit}`;
  return display === 'ft-in' ? `${base}' in"` : base;
}

/** `0.25` -> `0.25`, `1.0` -> `1`. Avoids `1` rendering as `1.0000000`. */
function trimNumber(value: number): string {
  return String(Number(value.toFixed(8)));
}
