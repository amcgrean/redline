/**
 * Stamps (PLAN §3.6 "Stamps", §3.9): `/Subtype /Stamp` with a distinctive `/Name`,
 * `/Subj (Stamp)`, `/Contents` carrying the baked text, and a self-contained `/AP`.
 *
 * The artwork is embedded ONCE as a form XObject (`embedStampArtwork`); every placement
 * gets its own small `/AP` that maps that XObject into the annotation's `/Rect` with the
 * requested rotation and opacity. "Stamp all pages" therefore adds one XObject and N
 * thin appearance streams. Revu shows these as Stamp markups with editable colour,
 * opacity and rotation (needs Aaron's check; PLAN row 9 of the interop checklist).
 *
 * Artwork kinds:
 * - `text`: lines of Helvetica in a colour with a border (the built-in library);
 * - `image`: PNG or JPEG bytes (an SVG must be rasterised by the caller — pdf-core is
 *   DOM-free);
 * - `pdf`: one page of another PDF, embedded as vector content.
 */

import {
  PDFArray,
  PDFName,
  PDFNumber,
  PDFStream,
  type PDFContext,
  type PDFDict,
  type PDFRef,
} from '@cantoo/pdf-lib';
import type { Markup, Point, RGB, Rect, RedlineDocument } from '../types.js';
import { generateUniqueNM } from '../ids.js';
import { numArray, pdfText, round } from '../annots/dict.js';
import { writeCommonKeys } from '../annots/common.js';
import { parseAnnotation } from '../annots/parse.js';
import { annotsArrayForWrite } from '../document/save.js';
import { ALPHA_GS, CAPTION_FONT, buildFormXObject, setAppearance } from '../annots/ap/form.js';
import { ContentBuilder, helveticaWidth } from '../annots/ap/content.js';

export type StampArtwork =
  | { kind: 'text'; lines: string[]; color: RGB; border?: boolean }
  | { kind: 'image'; format: 'png' | 'jpg'; bytes: Uint8Array }
  | { kind: 'pdf'; bytes: Uint8Array; pageIndex?: number };

/** Embedded artwork: a form XObject whose `/BBox` is `[0 0 width height]`. */
export interface StampSource {
  ref: PDFRef;
  width: number;
  height: number;
}

const TEXT_PAD = 10;
const HEADLINE_SIZE = 28;
const LINE_SIZE = 12;
const BORDER = 2;

function textArtwork(context: PDFContext, lines: string[], color: RGB, border: boolean) {
  const sizes = lines.map((_, i) => (i === 0 ? HEADLINE_SIZE : LINE_SIZE));
  const widths = lines.map((line, i) => helveticaWidth(line, sizes[i]!));
  const width = Math.max(40, ...widths) + TEXT_PAD * 2;
  const gap = 4;
  const textHeight = sizes.reduce((acc, s) => acc + s, 0) + gap * (lines.length - 1);
  const height = textHeight + TEXT_PAD * 2;
  const b = new ContentBuilder();
  b.save();
  b.strokeColor(color).fillColor(color).lineWidth(BORDER);
  if (border) b.rect(BORDER / 2, BORDER / 2, width - BORDER, height - BORDER).stroke();
  // Lines from the top; each baseline sits `descent` above the line's bottom.
  let top = height - TEXT_PAD;
  lines.forEach((line, i) => {
    const size = sizes[i]!;
    const baseline = top - size * 0.78;
    b.text(CAPTION_FONT, size, (width - widths[i]!) / 2, baseline, line);
    top -= size + gap;
  });
  b.restore();
  const stream = buildFormXObject(context, {
    bbox: [0, 0, round(width), round(height)],
    content: b.toString(),
    withFont: true,
  });
  return { ref: context.register(stream), width: round(width), height: round(height) };
}

/** Wrap an image or embedded page XObject in a form with a `[0 0 w h]` BBox. */
function wrapXObject(
  context: PDFContext,
  inner: PDFRef,
  width: number,
  height: number,
  content: string,
): StampSource {
  const stream = buildFormXObject(context, {
    bbox: [0, 0, round(width), round(height)],
    content,
    xobjects: { Src: inner },
  });
  return { ref: context.register(stream), width: round(width), height: round(height) };
}

/** Embed artwork once; the result can be placed any number of times. */
export async function embedStampArtwork(
  doc: RedlineDocument,
  artwork: StampArtwork,
): Promise<StampSource> {
  const context = doc.pdfDoc.context;
  if (artwork.kind === 'text') {
    return textArtwork(context, artwork.lines, artwork.color, artwork.border ?? true);
  }
  if (artwork.kind === 'image') {
    const image =
      artwork.format === 'png'
        ? await doc.pdfDoc.embedPng(artwork.bytes)
        : await doc.pdfDoc.embedJpg(artwork.bytes);
    // Incremental saves do not flush deferred embeds; do it now.
    await image.embed();
    const content = `q ${round(image.width)} 0 0 ${round(image.height)} 0 0 cm /Src Do Q`;
    return wrapXObject(context, image.ref, image.width, image.height, content);
  }
  const [page] = await doc.pdfDoc.embedPdf(artwork.bytes, [artwork.pageIndex ?? 0]);
  if (!page) throw new Error('No page to embed');
  await page.embed();
  // The embedded form keeps the source page's box; shift it so it starts at the origin.
  const form = context.lookup(page.ref);
  let x0 = 0;
  let y0 = 0;
  if (form instanceof PDFStream) {
    const bbox = form.dict.get(PDFName.of('BBox'));
    if (bbox instanceof PDFArray && bbox.size() === 4) {
      const a = bbox.lookup(0);
      const b = bbox.lookup(1);
      if (a instanceof PDFNumber) x0 = a.asNumber();
      if (b instanceof PDFNumber) y0 = b.asNumber();
    }
  }
  const content = `q 1 0 0 1 ${round(-x0)} ${round(-y0)} cm /Src Do Q`;
  return wrapXObject(context, page.ref, page.width, page.height, content);
}

export interface StampOptions {
  /** `/Name`, e.g. `RedlineApproved`. Letters, digits and hyphens only. */
  name: string;
  /** `/Contents`: the baked text (what the Markups List shows as the comment). */
  contents: string;
  author: string;
  subject?: string;
  /** 0..1, written as `/CA` and applied in the appearance. */
  opacity?: number;
  /** Clockwise, multiples of 90. */
  rotation?: 0 | 90 | 180 | 270;
  now?: Date;
  nm?: string;
}

/** The `cm` matrix that maps the source's `[0 0 w h]` into `rect` with `rotation`. */
export function stampMatrix(
  source: { width: number; height: number },
  rect: Rect,
  rotation: 0 | 90 | 180 | 270,
): [number, number, number, number, number, number] {
  const [x0, y0, x1, y1] = rect;
  const w = x1 - x0;
  const h = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const sideways = rotation === 90 || rotation === 270;
  const sx = (sideways ? h : w) / source.width;
  const sy = (sideways ? w : h) / source.height;
  const rad = (-rotation * Math.PI) / 180; // clockwise in PDF's y-up space
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // M = T(cx,cy) · R · S · T(-sw/2, -sh/2)
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const tx = cx - (a * source.width) / 2 - (c * source.height) / 2;
  const ty = cy - (b * source.width) / 2 - (d * source.height) / 2;
  return [round(a), round(b), round(c), round(d), round(tx), round(ty)];
}

function stampName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9-]/g, '');
  return clean || 'RedlineStamp';
}

/** Place an embedded stamp on a page. `rect` is the annotation's `/Rect` in user space. */
export function addStamp(
  doc: RedlineDocument,
  pageIndex: number,
  rect: Rect,
  source: StampSource,
  options: StampOptions,
): Markup {
  const context = doc.pdfDoc.context;
  const page = doc.pdfDoc.getPage(pageIndex);
  const now = options.now ?? new Date();
  const opacity = options.opacity ?? 1;
  const rotation = options.rotation ?? 0;
  const nm = options.nm ?? generateUniqueNM(doc.usedNM);
  if (options.nm) doc.usedNM.add(options.nm);
  const r: Rect = [round(rect[0]), round(rect[1]), round(rect[2]), round(rect[3])];

  const annot = context.obj({}) as PDFDict;
  writeCommonKeys(
    context,
    annot,
    page.ref,
    nm,
    { subject: options.subject ?? 'Stamp', author: options.author },
    { stroke: { r: 0, g: 0, b: 0 }, opacity, width: 0 },
    now,
  );
  annot.set(PDFName.of('Subtype'), PDFName.of('Stamp'));
  annot.set(PDFName.of('Name'), PDFName.of(stampName(options.name)));
  annot.set(PDFName.of('Contents'), pdfText(options.contents));
  annot.set(PDFName.of('Rect'), numArray(context, r));
  annot.delete(PDFName.of('BS'));
  annot.delete(PDFName.of('C'));

  const m = stampMatrix(source, r, rotation);
  const b = new ContentBuilder();
  b.save();
  if (opacity < 1) b.extGState(ALPHA_GS);
  b.push(`${m.join(' ')} cm`).push('/Fm0 Do');
  b.restore();
  const stream = buildFormXObject(context, {
    bbox: r,
    content: b.toString(),
    xobjects: { Fm0: source.ref },
    ...(opacity < 1 && { alpha: { stroke: opacity, fill: opacity } }),
  });
  setAppearance(context, annot, context.register(stream));

  const ref = context.register(annot);
  annotsArrayForWrite(doc, pageIndex).push(ref);
  const markup = parseAnnotation(ref, annot, pageIndex, nm);
  doc.markups.push(markup);
  return markup;
}

export type StampCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export interface StampPlacement {
  corner: StampCorner;
  /** Width of the stamp in points; height follows the artwork's aspect. */
  width: number;
  /** Distance from the page edges in points. */
  margin?: number;
}

/** The `/Rect` for a placement on a page of `pageSize`, in unrotated user space. */
export function placementRect(
  source: { width: number; height: number },
  pageSize: { width: number; height: number },
  placement: StampPlacement,
): Rect {
  const w = placement.width;
  const h = (placement.width * source.height) / source.width;
  const m = placement.margin ?? 36;
  const left = placement.corner.endsWith('left')
    ? m
    : placement.corner.endsWith('right')
      ? pageSize.width - m - w
      : (pageSize.width - w) / 2;
  const bottom = placement.corner.startsWith('top')
    ? pageSize.height - m - h
    : placement.corner.startsWith('bottom')
      ? m
      : (pageSize.height - h) / 2;
  return [round(left), round(bottom), round(left + w), round(bottom + h)];
}

/** A `/Rect` of the artwork's aspect with its top-left at `at`. */
export function rectAt(source: { width: number; height: number }, at: Point, width: number): Rect {
  const h = (width * source.height) / source.width;
  return [round(at.x), round(at.y - h), round(at.x + width), round(at.y)];
}

/** Place the same embedded stamp on every page (or the given pages). */
export function stampPages(
  doc: RedlineDocument,
  source: StampSource,
  placement: StampPlacement,
  options: Omit<StampOptions, 'nm'> & { pages?: readonly number[]; nms?: readonly string[] },
): Markup[] {
  const pages = options.pages ?? doc.pageSizes.map((_, i) => i);
  return pages.map((pageIndex, k) => {
    const size = doc.pageSizes[pageIndex];
    if (!size) throw new Error(`No page ${pageIndex}`);
    const rect = placementRect(source, size, placement);
    const nm = options.nms?.[k];
    return addStamp(doc, pageIndex, rect, source, nm ? { ...options, nm } : options);
  });
}
