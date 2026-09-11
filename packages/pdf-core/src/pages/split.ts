/**
 * Split (PLAN §3.9): by page ranges (`1-3, 4, 7-9`) or every N pages. Each part is an
 * `extractPages` copy, so markups ride along.
 */

import type { RedlineDocument } from '../types.js';
import { extractPages } from './ops.js';

/** Parse `1-3, 5, 8-` (1-based, inclusive; open end = last page) into 0-based index lists. */
export function parseRanges(text: string, pageCount: number): number[][] {
  const parts = text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const out: number[][] = [];
  for (const part of parts) {
    const m = /^(\d+)\s*(?:-\s*(\d*))?$/.exec(part);
    if (!m) throw new Error(`Cannot read page range "${part}"`);
    const start = Number(m[1]);
    const end = m[2] === undefined ? start : m[2] === '' ? pageCount : Number(m[2]);
    if (start < 1 || end > pageCount || end < start) {
      throw new Error(`Range "${part}" is outside 1-${pageCount}`);
    }
    out.push(Array.from({ length: end - start + 1 }, (_, k) => start - 1 + k));
  }
  if (out.length === 0) throw new Error('No page ranges given');
  return out;
}

/** `[[0..n-1], [n..2n-1], …]`. */
export function everyN(pageCount: number, n: number): number[][] {
  if (!Number.isInteger(n) || n < 1) throw new Error('Pages per part must be a whole number ≥ 1');
  const out: number[][] = [];
  for (let start = 0; start < pageCount; start += n) {
    out.push(Array.from({ length: Math.min(n, pageCount - start) }, (_, k) => start + k));
  }
  return out;
}

export interface SplitPart {
  /** 1-based first and last page of the part, for file names. */
  from: number;
  to: number;
  bytes: Uint8Array;
}

export async function splitDocument(
  doc: RedlineDocument,
  ranges: readonly (readonly number[])[],
): Promise<SplitPart[]> {
  const parts: SplitPart[] = [];
  for (const range of ranges) {
    if (range.length === 0) continue;
    parts.push({
      from: Math.min(...range) + 1,
      to: Math.max(...range) + 1,
      bytes: await extractPages(doc, range),
    });
  }
  return parts;
}
