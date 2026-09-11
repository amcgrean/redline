/**
 * Compress — Reduce-images support (PLAN §3.9): inventory the image XObjects a document
 * draws and swap one for a re-encoded JPEG. Decoding and re-encoding happen outside
 * pdf-core (the web app renders each image through pdf.js and a canvas); this module only
 * finds candidates and rewrites the object graph.
 *
 * Effective resolution is estimated from the page the image sits on: a scan covers its
 * page, so `pixels / page inches` is the DPI a downsample should compare against. Images
 * with an `/SMask`, `/Mask` or `/ImageMask` are reported but flagged `keep`, because a
 * JPEG cannot carry their transparency.
 */

import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, PDFStream } from '@cantoo/pdf-lib';
import type { RedlineDocument } from '../types.js';

export interface ImageInfo {
  ref: PDFRef;
  /** Pixel dimensions. */
  width: number;
  height: number;
  bitsPerComponent: number;
  colorSpace: string;
  /** `/Filter` names, outermost first. */
  filters: string[];
  /** Compressed bytes in the file. */
  bytes: number;
  /** Pages (indices) whose resources reference the image. */
  pages: number[];
  /** Estimated dots per inch when the image fills the smallest page it appears on. */
  dpi: number;
  /** False when re-encoding would lose transparency or masking. */
  replaceable: boolean;
}

function namesOf(value: unknown): string[] {
  if (value instanceof PDFName) return [value.decodeText()];
  if (value instanceof PDFArray) {
    const out: string[] = [];
    for (let i = 0; i < value.size(); i += 1) {
      const n = value.lookup(i);
      if (n instanceof PDFName) out.push(n.decodeText());
    }
    return out;
  }
  return [];
}

function colorSpaceName(value: unknown): string {
  if (value instanceof PDFName) return value.decodeText();
  if (value instanceof PDFArray && value.size() > 0) {
    const first = value.lookup(0);
    return first instanceof PDFName ? first.decodeText() : 'Array';
  }
  return 'Unknown';
}

/** Every image XObject reachable from page resources (one level of nested forms too). */
export function listImages(doc: RedlineDocument): ImageInfo[] {
  const context = doc.pdfDoc.context;
  const found = new Map<string, ImageInfo>();

  const visitXObjects = (resources: PDFDict | undefined, pageIndex: number, depth: number) => {
    if (!resources) return;
    const xobjects = resources.lookup(PDFName.of('XObject'));
    if (!(xobjects instanceof PDFDict)) return;
    for (const [, value] of xobjects.entries()) {
      if (!(value instanceof PDFRef)) continue;
      const stream = context.lookup(value);
      if (!(stream instanceof PDFStream)) continue;
      const subtype = stream.dict.lookup(PDFName.of('Subtype'));
      if (subtype === PDFName.of('Form')) {
        if (depth < 1) {
          const inner = stream.dict.lookup(PDFName.of('Resources'));
          visitXObjects(inner instanceof PDFDict ? inner : undefined, pageIndex, depth + 1);
        }
        continue;
      }
      if (subtype !== PDFName.of('Image')) continue;
      const key = value.toString();
      const existing = found.get(key);
      if (existing) {
        if (!existing.pages.includes(pageIndex)) existing.pages.push(pageIndex);
        continue;
      }
      const w = stream.dict.lookup(PDFName.of('Width'));
      const h = stream.dict.lookup(PDFName.of('Height'));
      const bpc = stream.dict.lookup(PDFName.of('BitsPerComponent'));
      const width = w instanceof PDFNumber ? w.asNumber() : 0;
      const height = h instanceof PDFNumber ? h.asNumber() : 0;
      const masked =
        stream.dict.has(PDFName.of('SMask')) ||
        stream.dict.has(PDFName.of('Mask')) ||
        stream.dict.lookup(PDFName.of('ImageMask')) instanceof Object;
      found.set(key, {
        ref: value,
        width,
        height,
        bitsPerComponent: bpc instanceof PDFNumber ? bpc.asNumber() : 8,
        colorSpace: colorSpaceName(stream.dict.lookup(PDFName.of('ColorSpace'))),
        filters: namesOf(stream.dict.lookup(PDFName.of('Filter'))),
        bytes: stream.getContents().length,
        pages: [pageIndex],
        dpi: 0,
        replaceable: width > 0 && height > 0 && !masked,
      });
    }
  };

  for (let i = 0; i < doc.pdfDoc.getPageCount(); i += 1) {
    const page = doc.pdfDoc.getPage(i);
    visitXObjects(page.node.Resources(), i, 0);
  }

  for (const info of found.values()) {
    let dpi = 0;
    for (const pageIndex of info.pages) {
      const size = doc.pageSizes[pageIndex];
      if (!size) continue;
      const rotated = size.rotation === 90 || size.rotation === 270;
      const pageW = (rotated ? size.height : size.width) / 72;
      const pageH = (rotated ? size.width : size.height) / 72;
      const candidate = Math.min(info.width / pageW, info.height / pageH);
      dpi = dpi === 0 ? candidate : Math.min(dpi, candidate);
    }
    info.dpi = Math.round(dpi);
  }
  return [...found.values()];
}

/** Pixel size an image should shrink to for `targetDpi`, or undefined when it is already at or below it. */
export function downsampleTarget(
  info: Pick<ImageInfo, 'width' | 'height' | 'dpi'>,
  targetDpi: number,
): { width: number; height: number } | undefined {
  if (info.dpi <= 0 || info.dpi <= targetDpi) return undefined;
  const factor = targetDpi / info.dpi;
  return {
    width: Math.max(1, Math.round(info.width * factor)),
    height: Math.max(1, Math.round(info.height * factor)),
  };
}

/**
 * Replace the image object behind `ref` with a JPEG (DCTDecode) of the given pixel size.
 * The object number is kept, so every page and form that drew the old image now draws
 * the new one; `saveFull` (then qpdf Optimize) drops the old bytes.
 */
export async function replaceImageWithJpeg(
  doc: RedlineDocument,
  ref: PDFRef,
  jpeg: Uint8Array,
): Promise<{ width: number; height: number; bytes: number }> {
  const context = doc.pdfDoc.context;
  const image = await doc.pdfDoc.embedJpg(jpeg);
  await image.embed();
  const fresh = context.lookup(image.ref);
  if (!(fresh instanceof PDFStream)) throw new Error('JPEG embed produced no stream');
  context.assign(ref, fresh);
  context.delete(image.ref);
  return { width: image.width, height: image.height, bytes: jpeg.length };
}
