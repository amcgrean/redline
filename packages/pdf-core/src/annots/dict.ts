/**
 * Small typed readers over pdf-lib's raw objects. Everything here is read-only: nothing
 * in this file mutates a dictionary, so it is safe to use on keys Redline does not own.
 */

import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFContext,
} from '@cantoo/pdf-lib';
import type { RGB } from '../types.js';

export function lookupDict(dict: PDFDict, key: string): PDFDict | undefined {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFDict ? value : undefined;
}

export function lookupArray(dict: PDFDict, key: string): PDFArray | undefined {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFArray ? value : undefined;
}

export function lookupNumber(dict: PDFDict, key: string): number | undefined {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

export function lookupBool(dict: PDFDict, key: string): boolean | undefined {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFBool ? value.asBoolean() : undefined;
}

/** `/Subtype`, `/IT` and friends: returns the name without its leading slash. */
export function lookupName(dict: PDFDict, key: string): string | undefined {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFName ? value.asString().replace(/^\//, '') : undefined;
}

/** Text strings: handles both literal `(...)` and hex `<...>` forms. */
export function lookupText(dict: PDFDict, key: string): string | undefined {
  const value = dict.lookup(PDFName.of(key));
  if (value instanceof PDFString) return value.decodeText();
  if (value instanceof PDFHexString) return value.decodeText();
  return undefined;
}

/** The raw reference stored at `key`, or undefined when the value is direct. */
export function lookupRef(dict: PDFDict, key: string): PDFRef | undefined {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFRef ? value : undefined;
}

/** A numeric array such as `/L`, `/Vertices`, `/Rect`, `/QuadPoints`. */
export function numberArray(dict: PDFDict, key: string): number[] | undefined {
  const arr = lookupArray(dict, key);
  if (!arr) return undefined;
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i += 1) {
    const item = arr.lookup(i);
    if (!(item instanceof PDFNumber)) return undefined;
    out.push(item.asNumber());
  }
  return out;
}

/** `/InkList`: an array of numeric arrays. */
export function numberArrayOfArrays(dict: PDFDict, key: string): number[][] | undefined {
  const arr = lookupArray(dict, key);
  if (!arr) return undefined;
  const out: number[][] = [];
  for (let i = 0; i < arr.size(); i += 1) {
    const item = arr.lookup(i);
    if (!(item instanceof PDFArray)) continue;
    const nums: number[] = [];
    for (let j = 0; j < item.size(); j += 1) {
      const n = item.lookup(j);
      if (n instanceof PDFNumber) nums.push(n.asNumber());
    }
    out.push(nums);
  }
  return out;
}

/**
 * `/C` and `/IC` colour arrays. PDF allows 0 (transparent), 1 (gray), 3 (RGB) or
 * 4 (CMYK) components; we normalise everything to RGB and treat length 0 as "no colour".
 */
export function lookupColor(dict: PDFDict, key: string): RGB | undefined {
  const comps = numberArray(dict, key);
  if (!comps || comps.length === 0) return undefined;
  if (comps.length === 1) {
    const g = comps[0]!;
    return { r: g, g, b: g };
  }
  if (comps.length >= 4) {
    const [c = 0, m = 0, y = 0, k = 0] = comps;
    return { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k) };
  }
  return { r: comps[0] ?? 0, g: comps[1] ?? 0, b: comps[2] ?? 0 };
}

/** Build a `/C`-style RGB array. */
export function colorArray(context: PDFContext, color: RGB): PDFArray {
  const arr = PDFArray.withContext(context);
  arr.push(PDFNumber.of(round(color.r)));
  arr.push(PDFNumber.of(round(color.g)));
  arr.push(PDFNumber.of(round(color.b)));
  return arr;
}

/** Build a numeric array, e.g. for `/Rect`, `/L`, `/Vertices`. */
export function numArray(context: PDFContext, values: readonly number[]): PDFArray {
  const arr = PDFArray.withContext(context);
  for (const v of values) arr.push(PDFNumber.of(round(v)));
  return arr;
}

/** Six decimals is well past PDF rendering precision and keeps diffs readable. */
export function round(value: number): number {
  const r = Number(value.toFixed(6));
  return Object.is(r, -0) ? 0 : r;
}

/**
 * PDF date string: `D:YYYYMMDDHHmmSSOHH'mm'`. Matches the form Revu writes,
 * e.g. `D:20260805134807-05'00'`.
 */
export function pdfDate(date: Date): string {
  const pad = (n: number, width = 2) => String(Math.abs(Math.trunc(n))).padStart(width, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  // Build the wall-clock components from UTC shifted by the offset rather than from the
  // local getters: identical in production, and it lets tests pin `getTimezoneOffset`
  // so date-bearing snapshots render the same on a UTC CI runner.
  const wall = new Date(date.getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  return (
    `D:${pad(wall.getUTCFullYear(), 4)}${pad(wall.getUTCMonth() + 1)}${pad(wall.getUTCDate())}` +
    `${pad(wall.getUTCHours())}${pad(wall.getUTCMinutes())}${pad(wall.getUTCSeconds())}` +
    `${sign}${pad(offsetMinutes / 60)}'${pad(offsetMinutes % 60)}'`
  );
}

/** Parse a PDF date string back into a Date. Returns undefined for anything unparseable. */
export function parsePdfDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const m =
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([+\-Z])(\d{2})'?(\d{2})?'?)?/.exec(
      value,
    );
  if (!m) return undefined;
  const [, year, month, day, hour, minute, second, tzSign, tzHour, tzMinute] = m;
  const iso =
    `${year}-${month ?? '01'}-${day ?? '01'}T${hour ?? '00'}:${minute ?? '00'}:${second ?? '00'}` +
    (tzSign && tzSign !== 'Z' ? `${tzSign}${tzHour ?? '00'}:${tzMinute ?? '00'}` : 'Z');
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
