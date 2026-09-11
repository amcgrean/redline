/**
 * Keys every new Redline markup gets (PLAN §3.4 "New markups get …"), shared by the
 * measurement writers and the shape writers.
 */

import type { PDFDict, PDFRef } from '@cantoo/pdf-lib';
import { PDFArray, PDFName, PDFNumber, PDFString, type PDFContext } from '@cantoo/pdf-lib';
import type { LineEnding, RGB } from '../types.js';
import { colorArray, numArray, pdfDate, round } from './dict.js';

/** The style keys `writeCommonKeys` needs; measurement and shape styles both satisfy it. */
export interface CommonStyle {
  stroke: RGB;
  fill?: RGB;
  opacity: number;
  width: number;
  dash?: number[];
}

export interface CommonOptions {
  subject: string;
  author: string;
}

export function borderStyle(context: PDFContext, width: number, dash?: number[]): PDFDict {
  const bs = context.obj({}) as PDFDict;
  bs.set(PDFName.of('Type'), PDFName.of('Border'));
  bs.set(PDFName.of('W'), PDFNumber.of(round(width)));
  if (dash?.length) {
    bs.set(PDFName.of('S'), PDFName.of('D'));
    bs.set(PDFName.of('D'), numArray(context, dash));
  } else {
    bs.set(PDFName.of('S'), PDFName.of('S'));
  }
  return bs;
}

export function lineEndingsArray(context: PDFContext, ends: [LineEnding, LineEnding]): PDFArray {
  const arr = PDFArray.withContext(context);
  arr.push(PDFName.of(ends[0]));
  arr.push(PDFName.of(ends[1]));
  return arr;
}

/** Keys shared by every new markup (PLAN §3.4 "New markups get …"). */
export function writeCommonKeys(
  context: PDFContext,
  annot: PDFDict,
  pageRef: PDFRef,
  nm: string,
  options: CommonOptions,
  style: CommonStyle,
  now: Date,
): void {
  const stamp = PDFString.of(pdfDate(now));
  annot.set(PDFName.of('Type'), PDFName.of('Annot'));
  annot.set(PDFName.of('P'), pageRef);
  annot.set(PDFName.of('NM'), PDFString.of(nm));
  annot.set(PDFName.of('T'), PDFString.of(options.author));
  annot.set(PDFName.of('Subj'), PDFString.of(options.subject));
  annot.set(PDFName.of('CreationDate'), stamp);
  annot.set(PDFName.of('M'), stamp);
  // Print flag only. Hidden, NoView and Locked are all clear.
  annot.set(PDFName.of('F'), PDFNumber.of(4));
  annot.set(PDFName.of('C'), colorArray(context, style.stroke));
  if (style.fill) annot.set(PDFName.of('IC'), colorArray(context, style.fill));
  annot.set(PDFName.of('CA'), PDFNumber.of(round(style.opacity)));
  annot.set(PDFName.of('BS'), borderStyle(context, style.width, style.dash));
}
