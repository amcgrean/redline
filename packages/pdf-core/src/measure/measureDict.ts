/**
 * `/Measure` and `/NumberFormat` construction. PLAN §3.6 "Measurements" + Appendix A.
 *
 * The shape below is copied from a real Revu 21 dictionary decoded out of
 * `fixtures/Takeoff bluebeam copy 16228 Sharon Drive - Urbandale.pdf` (object 99):
 *
 *   <</Type/Measure/Subtype/RL/R(0.25 in = 1 ft' in")
 *     /X[<</Type/NumberFormat/U(')/C 0.05555556/F/F/D 1/FD true/SS()>>]
 *     /D[<</Type/NumberFormat/U(')/C 1/F/F/D 1/FD true/PS()/SS(-)>>
 *        <</Type/NumberFormat/U(")/C 12/F/F/D 1/FD true/PS()/SS()>>]
 *     /A[<</Type/NumberFormat/U(sf)/C 1/D 1/FD true/SS()>>]
 *     /T[<</Type/NumberFormat/U(\260)/C 1/D 1/FD true/PS()/SS()>>]
 *     /V[<</Type/NumberFormat/U(cu ft)/C 1/D 1/FD true/SS()>>]
 *     /TargetUnitConversion 0.001157407>>
 *
 * VERIFIED from that file: `/Subtype /RL`; `/X` is a single NumberFormat whose `/C`
 * converts points -> world units; `/D` is the two-element feet/inches pair with the
 * hyphen carried as the feet element's `/SS`; `/A` has `/C 1`, i.e. Revu hands the area
 * formatter a value that is ALREADY in square world units; `/T` is degrees.
 * ASSUMED: `/V` and `/TargetUnitConversion` are optional for Revu to read a measurement.
 * We emit them anyway so our dictionaries look exactly like Revu's.
 */

import type { PDFDict } from '@cantoo/pdf-lib';
import { PDFArray, PDFName, PDFNumber, PDFString, type PDFContext } from '@cantoo/pdf-lib';
import type { Scale, UnitFormat, WorldUnit } from './units.js';
import { areaUnitLabel, convertWorld, displayUnit, worldUnitsPerPoint } from './units.js';
import { scaleRatioString } from './format.js';

/** Points -> feet at 1:1 (1/72 in, 12 in per ft). The value behind `/TargetUnitConversion`. */
const POINTS_TO_FEET = 1 / 864;

/**
 * Revu writes conversion factors to 7 significant digits (`0.05555556`, `0.001157407`,
 * and PLAN's `0.1111111`), so we do the same — it keeps our dictionaries diff-clean
 * against Revu's and is far past what a viewer can resolve on a drawing.
 */
function revuPrecision(value: number): number {
  return Number(value.toPrecision(7));
}

/** `/D` for a decimal NumberFormat: 0 decimals => 1, 2 decimals => 100. */
function decimalDenominator(decimals: number): number {
  return 10 ** Math.max(0, Math.trunc(decimals));
}

/** True when the display shows architectural fractions rather than decimals. */
function isFractional(display: UnitFormat['display']): boolean {
  return display === 'ft-in' || display === 'in';
}

interface NumberFormatSpec {
  /** `/U` — unit label. */
  unit: string;
  /** `/C` — conversion from the previous element's unit (from points, for the first). */
  conversion: number;
  /** `/F` — `D` decimal, `F` fraction, `R` round, `T` truncate. Omitted => decimal. */
  style?: 'D' | 'F' | 'R' | 'T';
  /** `/D` — denominator (fraction) or precision (decimal). */
  denominator: number;
  /** `/FD` — true: use the denominator as given rather than reducing to lowest terms. */
  fractionalDenominator?: boolean;
  /** `/PS` — prefix separator, placed before the value. */
  prefix?: string;
  /** `/SS` — suffix separator, placed after the unit. Revu's feet element uses `-`. */
  suffix?: string;
}

function numberFormat(context: PDFContext, spec: NumberFormatSpec): PDFDict {
  const dict = context.obj({}) as PDFDict;
  dict.set(PDFName.of('Type'), PDFName.of('NumberFormat'));
  dict.set(PDFName.of('U'), PDFString.of(spec.unit));
  dict.set(PDFName.of('C'), PDFNumber.of(revuPrecision(spec.conversion)));
  if (spec.style) dict.set(PDFName.of('F'), PDFName.of(spec.style));
  dict.set(PDFName.of('D'), PDFNumber.of(spec.denominator));
  dict.set(PDFName.of('FD'), context.obj(spec.fractionalDenominator ?? true));
  if (spec.prefix !== undefined) dict.set(PDFName.of('PS'), PDFString.of(spec.prefix));
  dict.set(PDFName.of('SS'), PDFString.of(spec.suffix ?? ''));
  return dict;
}

function array(context: PDFContext, items: PDFDict[]): PDFArray {
  const arr = PDFArray.withContext(context);
  for (const item of items) arr.push(item);
  return arr;
}

/** The unit label `/X` reports in, matching the first `/D` element. */
function distanceUnitLabel(format: UnitFormat): string {
  switch (format.display) {
    case 'ft-in':
    case 'decimal-ft':
      return "'";
    case 'in':
      return '"';
    default:
      return ` ${format.display}`;
  }
}

/**
 * The `/D` (distance) NumberFormat chain for a display format.
 *
 * Feet-inches is the two-element form: feet (`/C 1`, suffix `-`) then inches (`/C 12`,
 * 12 inches per foot). The first element's `/C` is relative to the value `/X` already
 * produced, which is why it is 1 rather than the points factor.
 */
export function distanceNumberFormats(context: PDFContext, format: UnitFormat): PDFDict[] {
  const fractional = isFractional(format.display);
  const denominator = fractional ? format.precision : decimalDenominator(format.precision);

  if (format.display === 'ft-in') {
    return [
      numberFormat(context, {
        unit: "'",
        conversion: 1,
        style: 'F',
        denominator,
        prefix: '',
        suffix: '-',
      }),
      numberFormat(context, {
        unit: '"',
        conversion: 12,
        style: 'F',
        denominator,
        prefix: '',
        suffix: '',
      }),
    ];
  }
  return [
    numberFormat(context, {
      unit: distanceUnitLabel(format),
      conversion: 1,
      style: fractional ? 'F' : 'D',
      denominator,
      prefix: '',
      suffix: '',
    }),
  ];
}

export interface MeasureOptions {
  scale: Scale;
  format: UnitFormat;
  /** Decimal places for area totals. Revu writes whole square feet, i.e. 0. */
  areaDecimals?: number;
}

/**
 * Build a `/Measure` dictionary. Returns an unregistered `PDFDict`; the caller decides
 * whether to register it as an indirect object. Revu gives every viewport AND every
 * measurement annotation its own copy rather than sharing one reference, and
 * `addLengthMeasurement`/`addAreaMeasurement` do the same.
 */
export function buildMeasureDict(context: PDFContext, options: MeasureOptions): PDFDict {
  const { scale, format, areaDecimals = 0 } = options;
  const target = displayUnit(format.display);

  // `/X` converts one point into the display's world unit. Revu: 0.25 in = 1 ft -> 0.05555556.
  const perPointInScaleUnit = worldUnitsPerPoint(scale);
  const perPointInDisplayUnit = convertWorld(perPointInScaleUnit, scale.worldUnit, target);
  const fractional = isFractional(format.display);

  const dict = context.obj({}) as PDFDict;
  dict.set(PDFName.of('Type'), PDFName.of('Measure'));
  dict.set(PDFName.of('Subtype'), PDFName.of('RL'));
  dict.set(
    PDFName.of('R'),
    PDFString.of(
      scaleRatioString(
        scale.pageLength,
        scale.pageUnit,
        scale.worldLength,
        scale.worldUnit,
        format.display,
      ),
    ),
  );
  dict.set(
    PDFName.of('X'),
    array(context, [
      numberFormat(context, {
        unit: distanceUnitLabel(format),
        conversion: perPointInDisplayUnit,
        style: fractional ? 'F' : 'D',
        denominator: fractional ? format.precision : decimalDenominator(format.precision),
        suffix: '',
      }),
    ]),
  );
  dict.set(PDFName.of('D'), array(context, distanceNumberFormats(context, format)));
  dict.set(
    PDFName.of('A'),
    array(context, [
      numberFormat(context, {
        unit: areaUnitLabel(format.display),
        conversion: 1,
        denominator: decimalDenominator(areaDecimals),
        suffix: '',
      }),
    ]),
  );
  dict.set(
    PDFName.of('T'),
    array(context, [
      // U+00B0 serialises as the octal escape \260 in PDFDocEncoding — what Revu writes.
      numberFormat(context, {
        unit: '°',
        conversion: 1,
        denominator: 1,
        prefix: '',
        suffix: '',
      }),
    ]),
  );
  dict.set(
    PDFName.of('V'),
    array(context, [
      numberFormat(context, {
        unit: volumeUnitLabel(target),
        conversion: 1,
        denominator: 1,
        suffix: '',
      }),
    ]),
  );
  // Bluebeam key: points -> target unit at 1:1, independent of the drawing scale.
  dict.set(
    PDFName.of('TargetUnitConversion'),
    PDFNumber.of(revuPrecision(convertWorld(POINTS_TO_FEET, 'ft', target))),
  );
  return dict;
}

function volumeUnitLabel(unit: WorldUnit): string {
  return unit === 'ft' ? 'cu ft' : `cu ${unit}`;
}
