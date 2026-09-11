/**
 * Text markups (PLAN §3.10): text box, callout, sticky note.
 *
 * - Text box: `/FreeText` with `/DA` (default appearance string: colour + Helvetica size),
 *   `/Q` alignment, `/DS` (the CSS font string Revu reads), `/Contents`, generated `/AP`.
 * - Callout: the same plus `/IT /FreeTextCallout`, `/CL [tip knee box]` and `/LE`.
 * - Note: `/Text` with `/Name /Comment`, `/Open false`, `/Contents`, and a drawn icon so
 *   Chrome shows the same thing Acrobat and Revu do.
 *
 * ASSUMED (no Revu-authored text fixture yet): Revu reads `/DS` for font/size/colour and
 * `/DA` as the fallback; both are written. Bluebeam's `/RC` rich text is NOT generated —
 * Revu builds it from `/Contents` on its next edit.
 */

import type { PDFDict } from '@cantoo/pdf-lib';
import { PDFArray, PDFName, PDFNumber, PDFString, type PDFContext } from '@cantoo/pdf-lib';
import type { Markup, Point, Rect, RedlineDocument, RGB } from '../types.js';
import { generateUniqueNM } from '../ids.js';
import { lookupText, numArray, pdfDate, pdfText, round } from './dict.js';
import { annotsArrayForWrite, markChanged } from '../document/save.js';
import { requireMarkup } from '../document/open.js';
import { buildFormXObject, setAppearance } from './ap/form.js';
import type { AppearanceResult } from './ap/measurement.js';
import {
  buildNoteAppearance,
  buildTextBoxAppearance,
  textBoxHeight,
  wrapText,
  type TextAlign,
} from './ap/text.js';
import { writeCommonKeys } from './common.js';

export interface TextStyle {
  fontSize: number;
  fontColor: RGB;
  align: TextAlign;
  /** Border colour; undefined = no border. */
  stroke?: RGB;
  /** Box fill; undefined = transparent. */
  fill?: RGB;
  borderWidth: number;
  opacity: number;
  padding: number;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontSize: 10,
  fontColor: { r: 0, g: 0, b: 0 },
  align: 'left',
  stroke: { r: 0.83, g: 0.18, b: 0.18 },
  borderWidth: 1,
  opacity: 1,
  padding: 3,
};

export interface TextOptions {
  /** `/RLTool`: the tool chest tool that made the markup. */
  tool?: string;
  /** `/RLAttrs`: attribute values for formula columns. */
  attrs?: Record<string, string | number | boolean>;
  subject: string;
  author: string;
  text: string;
  style?: Partial<TextStyle>;
  now?: Date;
  nm?: string;
}

const NOTE_SIZE = 20;

function pdfColor(c: RGB): string {
  return `${round(c.r)} ${round(c.g)} ${round(c.b)} rg`;
}

/** `/DA`: what Acrobat uses to (re)build the appearance; `/DS`: what Revu uses. */
function writeTextKeys(context: PDFContext, annot: PDFDict, style: TextStyle, text: string): void {
  annot.set(
    PDFName.of('DA'),
    PDFString.of(`${pdfColor(style.fontColor)} /Helv ${round(style.fontSize)} Tf`),
  );
  annot.set(
    PDFName.of('Q'),
    PDFNumber.of(style.align === 'center' ? 1 : style.align === 'right' ? 2 : 0),
  );
  const hex = (c: RGB) =>
    '#' +
    [c.r, c.g, c.b]
      .map((v) =>
        Math.round(Math.max(0, Math.min(1, v)) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase();
  annot.set(
    PDFName.of('DS'),
    PDFString.of(
      `font: Helvetica ${round(style.fontSize)}pt; text-align:${style.align}; color:${hex(style.fontColor)}`,
    ),
  );
  annot.set(PDFName.of('Contents'), pdfText(text));
}

function attach(
  context: PDFContext,
  annot: PDFDict,
  appearance: AppearanceResult,
  opacity: number,
): Rect {
  const rect: Rect = [
    round(appearance.bounds[0]),
    round(appearance.bounds[1]),
    round(appearance.bounds[2]),
    round(appearance.bounds[3]),
  ];
  const stream = buildFormXObject(context, {
    bbox: rect,
    content: appearance.content,
    withFont: appearance.withFont,
    ...(opacity < 1 && { alpha: { stroke: opacity, fill: opacity } }),
  });
  setAppearance(context, annot, context.register(stream));
  annot.set(PDFName.of('Rect'), numArray(context, rect));
  return rect;
}

function commonStyle(style: TextStyle) {
  return {
    stroke: style.stroke ?? { r: 0, g: 0, b: 0 },
    ...(style.fill && { fill: style.fill }),
    opacity: style.opacity,
    width: style.stroke ? style.borderWidth : 0,
  };
}

/**
 * Size a text box to its content when the caller gives only a width (height <= 0):
 * the box grows downward from the top edge.
 */
function sizedRect(rect: Rect, text: string, style: TextStyle): Rect {
  const [x0, y0, x1, y1] = rect;
  if (y1 - y0 > 0) return rect;
  const lines = wrapText(text, style.fontSize, Math.max(1, x1 - x0 - style.padding * 2));
  const height = textBoxHeight(lines.length, style.fontSize, style.padding);
  return [x0, y1 - height, x1, y1];
}

/** Write a text box. `rect` is the box; pass `y0 === y1` to auto-size the height. */
export function addTextBox(
  doc: RedlineDocument,
  pageIndex: number,
  rect: Rect,
  options: TextOptions,
): Markup {
  return writeFreeText(doc, pageIndex, rect, options, undefined);
}

/**
 * Write a callout: a text box plus a leader from `target` (the arrowhead) with a knee
 * at the box's edge, as Acrobat's `/CL` expects (`[x1 y1 x2 y2 x3 y3]`: tip, knee, box).
 */
export function addCallout(
  doc: RedlineDocument,
  pageIndex: number,
  rect: Rect,
  target: Point,
  options: TextOptions,
): Markup {
  return writeFreeText(doc, pageIndex, rect, options, target);
}

/** The knee and box-edge points of a callout leader for a box and target. */
export function calloutLeader(rect: Rect, target: Point): Point[] {
  const [x0, y0, x1, y1] = rect;
  const cy = (y0 + y1) / 2;
  // Attach to the nearest vertical edge's midpoint, knee 20 pt out from it.
  const left = Math.abs(target.x - x0) < Math.abs(target.x - x1);
  const edge: Point = { x: left ? x0 : x1, y: cy };
  const knee: Point = { x: left ? x0 - 20 : x1 + 20, y: Math.min(Math.max(target.y, y0), y1) };
  return [target, knee, edge];
}

function writeFreeText(
  doc: RedlineDocument,
  pageIndex: number,
  rectIn: Rect,
  options: TextOptions,
  target: Point | undefined,
): Markup {
  const context = doc.pdfDoc.context;
  const page = doc.pdfDoc.getPage(pageIndex);
  const style: TextStyle = { ...DEFAULT_TEXT_STYLE, ...options.style };
  const now = options.now ?? new Date();
  const nm = options.nm ?? generateUniqueNM(doc.usedNM);
  if (options.nm) doc.usedNM.add(options.nm);
  const rect = sizedRect(rectIn, options.text, style);

  const annot = context.obj({}) as PDFDict;
  writeCommonKeys(
    context,
    annot,
    page.ref,
    nm,
    { subject: options.subject, author: options.author, tool: options.tool, attrs: options.attrs },
    commonStyle(style),
    now,
  );
  annot.set(PDFName.of('Subtype'), PDFName.of('FreeText'));
  writeTextKeys(context, annot, style, options.text);

  let leader: Point[] | undefined;
  if (target) {
    leader = calloutLeader(rect, target);
    annot.set(PDFName.of('IT'), PDFName.of('FreeTextCallout'));
    annot.set(
      PDFName.of('CL'),
      numArray(
        context,
        leader.flatMap((p) => [p.x, p.y]),
      ),
    );
    const le = PDFArray.withContext(context);
    le.push(PDFName.of('ClosedArrow'));
    annot.set(PDFName.of('LE'), le);
  }

  const appearance = buildTextBoxAppearance({
    rect,
    text: options.text,
    fontSize: style.fontSize,
    fontColor: style.fontColor,
    align: style.align,
    ...(style.stroke && { stroke: style.stroke }),
    ...(style.fill && { fill: style.fill }),
    borderWidth: style.stroke ? style.borderWidth : 0,
    opacity: style.opacity,
    padding: style.padding,
    ...(leader && { leader }),
  });
  const bounds = attach(context, annot, appearance, style.opacity);
  // For a callout /Rect covers the leader too; /RD keeps the text box inside it.
  if (leader) {
    annot.set(
      PDFName.of('RD'),
      numArray(context, [
        rect[0] - bounds[0],
        rect[1] - bounds[1],
        bounds[2] - rect[2],
        bounds[3] - rect[3],
      ]),
    );
  }

  const ref = context.register(annot);
  annotsArrayForWrite(doc, pageIndex).push(ref);

  const markup: Markup = {
    id: nm,
    pageIndex,
    subtype: 'FreeText',
    rawSubtype: 'FreeText',
    ...(target && { intent: 'FreeTextCallout' }),
    ...(leader && { callout: leader }),
    geometry: { kind: 'rect', rect },
    rect: bounds,
    style: {
      ...(style.stroke && { stroke: style.stroke }),
      ...(style.fill && { fill: style.fill }),
      opacity: style.opacity,
      width: style.stroke ? style.borderWidth : 0,
      font: { family: 'Helvetica', size: style.fontSize, color: style.fontColor },
    },
    text: {
      contents: options.text,
      subject: options.subject,
      author: options.author,
      created: now,
      modified: now,
    },
    relations: {},
    ...(options.tool && { tool: options.tool }),
    ...(options.attrs && { attrs: options.attrs }),
    flags: { locked: false, hidden: false, print: true },
    raw: annot,
    ref,
    render: 'native',
  };
  doc.markups.push(markup);
  return markup;
}

export interface NoteOptions {
  /** `/RLTool`: the tool chest tool that made the markup. */
  tool?: string;
  /** `/RLAttrs`: attribute values for formula columns. */
  attrs?: Record<string, string | number | boolean>;
  subject: string;
  author: string;
  text: string;
  color?: RGB;
  now?: Date;
  nm?: string;
}

/** Write a sticky note (`/Text`) at `at` (top-left of a 20 x 20 pt icon). */
export function addNote(
  doc: RedlineDocument,
  pageIndex: number,
  at: Point,
  options: NoteOptions,
): Markup {
  const context = doc.pdfDoc.context;
  const page = doc.pdfDoc.getPage(pageIndex);
  const color = options.color ?? { r: 1, g: 0.85, b: 0.2 };
  const now = options.now ?? new Date();
  const nm = options.nm ?? generateUniqueNM(doc.usedNM);
  if (options.nm) doc.usedNM.add(options.nm);
  const rect: Rect = [at.x, at.y - NOTE_SIZE, at.x + NOTE_SIZE, at.y];

  const annot = context.obj({}) as PDFDict;
  writeCommonKeys(
    context,
    annot,
    page.ref,
    nm,
    { subject: options.subject, author: options.author, tool: options.tool, attrs: options.attrs },
    { stroke: color, opacity: 1, width: 1 },
    now,
  );
  annot.set(PDFName.of('Subtype'), PDFName.of('Text'));
  annot.set(PDFName.of('Name'), PDFName.of('Comment'));
  annot.set(PDFName.of('Open'), context.obj(false));
  annot.set(PDFName.of('Contents'), pdfText(options.text));
  // Notes are fixed-size icons: NoZoom + NoRotate on top of Print.
  annot.set(PDFName.of('F'), PDFNumber.of(4 | 8 | 16));
  attach(context, annot, buildNoteAppearance({ rect, color, opacity: 1 }), 1);

  const ref = context.register(annot);
  annotsArrayForWrite(doc, pageIndex).push(ref);

  const markup: Markup = {
    id: nm,
    pageIndex,
    subtype: 'Text',
    rawSubtype: 'Text',
    geometry: { kind: 'rect', rect },
    rect,
    style: { stroke: color, fill: color, opacity: 1, width: 1 },
    text: {
      contents: options.text,
      subject: options.subject,
      author: options.author,
      created: now,
      modified: now,
    },
    relations: {},
    ...(options.tool && { tool: options.tool }),
    ...(options.attrs && { attrs: options.attrs }),
    flags: { locked: false, hidden: false, print: true },
    raw: annot,
    ref,
    render: 'native',
  };
  doc.markups.push(markup);
  return markup;
}

/**
 * Change the text of a text box, callout or note. Rewrites `/Contents` (and `/RC` when
 * present, mirroring it), regenerates the `/AP` for Redline-drawn text, bumps `/M`.
 */
export function setMarkupText(
  doc: RedlineDocument,
  id: string,
  text: string,
  now: Date = new Date(),
): Markup {
  const markup = requireMarkup(doc, id);
  const raw = markup.raw;
  raw.set(PDFName.of('Contents'), pdfText(text));
  const rc = lookupText(raw, 'RC');
  if (rc !== undefined) {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    raw.set(
      PDFName.of('RC'),
      PDFString.of(rc.replace(/>([^<]*)<\/body>/, () => `>${escaped}</body>`)),
    );
  }
  markup.text = { subject: '', author: '', ...markup.text, contents: text, modified: now };
  if (markup.rawSubtype === 'FreeText' && markup.geometry.kind === 'rect') {
    regenerateTextAppearance(doc, markup);
  }
  raw.set(PDFName.of('M'), PDFString.of(pdfDate(now)));
  markChanged(doc, markup.ref);
  return markup;
}

/** Rebuild a FreeText appearance from its dictionary (text, /DA, /Q, /CL) and model style. */
export function regenerateTextAppearance(doc: RedlineDocument, markup: Markup): boolean {
  if (markup.rawSubtype !== 'FreeText' || markup.geometry.kind !== 'rect') return false;
  const raw = markup.raw;
  const style = textStyleOf(markup);
  const cl = raw.lookup(PDFName.of('CL'));
  let leader: Point[] | undefined;
  if (cl instanceof PDFArray && cl.size() >= 4) {
    const nums: number[] = [];
    for (let i = 0; i < cl.size(); i += 1) {
      const n = cl.lookup(i);
      if (n instanceof PDFNumber) nums.push(n.asNumber());
    }
    const tip = { x: nums[0]!, y: nums[1]! };
    // Re-route the leader to the (possibly resized/moved) box so knee and edge stay attached.
    leader = calloutLeader(markup.geometry.rect, tip);
    raw.set(
      PDFName.of('CL'),
      numArray(
        doc.pdfDoc.context,
        leader.flatMap((p) => [p.x, p.y]),
      ),
    );
    markup.callout = leader;
  }
  const appearance = buildTextBoxAppearance({
    rect: markup.geometry.rect,
    text: markup.text?.contents ?? '',
    fontSize: style.fontSize,
    fontColor: style.fontColor,
    align: style.align,
    ...(style.stroke && { stroke: style.stroke }),
    ...(style.fill && { fill: style.fill }),
    borderWidth: style.stroke ? style.borderWidth : 0,
    opacity: style.opacity,
    padding: style.padding,
    ...(leader && { leader }),
  });
  markup.rect = attach(doc.pdfDoc.context, raw, appearance, style.opacity);
  if (leader) {
    const r = markup.geometry.rect;
    const b = markup.rect;
    raw.set(
      PDFName.of('RD'),
      numArray(doc.pdfDoc.context, [r[0] - b[0], r[1] - b[1], b[2] - r[2], b[3] - r[3]]),
    );
  }
  return true;
}

/** Style of an existing FreeText from the model plus `/DA`/`/Q`. */
export function textStyleOf(markup: Markup): TextStyle {
  const da = lookupText(markup.raw, 'DA') ?? '';
  const sizeMatch = /\/\S+\s+([\d.]+)\s+Tf/.exec(da);
  const colorMatch = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
  const q = markup.raw.lookup(PDFName.of('Q'));
  const qv = q instanceof PDFNumber ? q.asNumber() : 0;
  return {
    fontSize:
      markup.style.font?.size ?? (sizeMatch ? Number(sizeMatch[1]) : DEFAULT_TEXT_STYLE.fontSize),
    fontColor:
      markup.style.font?.color ??
      (colorMatch
        ? { r: Number(colorMatch[1]), g: Number(colorMatch[2]), b: Number(colorMatch[3]) }
        : DEFAULT_TEXT_STYLE.fontColor),
    align: qv === 1 ? 'center' : qv === 2 ? 'right' : 'left',
    ...(markup.style.stroke && markup.style.width > 0 && { stroke: markup.style.stroke }),
    ...(markup.style.fill && { fill: markup.style.fill }),
    borderWidth: markup.style.width,
    opacity: markup.style.opacity,
    padding: DEFAULT_TEXT_STYLE.padding,
  };
}
