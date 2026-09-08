/**
 * AP-bitmap fallback (PLAN §3.5): wrap an annotation's `/AP /N` form XObject in a
 * temporary one-page PDF via pdf-lib, render it with pdf.js, and hand the canvas to the
 * Konva layer. The markup stays selectable and movable; its dictionary is untouched.
 *
 * The temporary document is a throwaway in memory; nothing here writes to the real file.
 */

import {
  type PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObjectCopier,
  PDFStream,
} from '@cantoo/pdf-lib';
import type { Markup, Rect } from '@redline/pdf-core';
import { loadPdfjs, AnnotationMode } from './pdfjs';

function numbers(arr: PDFArray | undefined, count: number): number[] | undefined {
  if (!arr || arr.size() < count) return undefined;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const n = arr.lookup(i);
    if (!(n instanceof PDFNumber)) return undefined;
    out.push(n.asNumber());
  }
  return out;
}

/** Resolve `/AP /N`, following an appearance-state sub-dictionary if present. */
function normalAppearance(markup: Markup): PDFStream | undefined {
  const ap = markup.raw.lookup(PDFName.of('AP'));
  if (!(ap instanceof PDFDict)) return undefined;
  const n = ap.lookup(PDFName.of('N'));
  if (n instanceof PDFStream) return n;
  if (n instanceof PDFDict) {
    const as = markup.raw.lookup(PDFName.of('AS'));
    const key = as instanceof PDFName ? as : n.keys()[0];
    const state = key ? n.lookup(key) : undefined;
    return state instanceof PDFStream ? state : undefined;
  }
  return undefined;
}

/**
 * The "appearance streams" algorithm (ISO 32000-1 §12.5.5): transform `/BBox` by
 * `/Matrix`, then map that box onto `/Rect`. Returns the `cm` that places the form so
 * the annotation's Rect lands at the page origin of a `rectWidth` x `rectHeight` page.
 */
function placementMatrix(bbox: number[], matrix: number[], rect: Rect): number[] {
  const [a, b, c, d, e, f] = matrix as [number, number, number, number, number, number];
  const corners = [
    [bbox[0]!, bbox[1]!],
    [bbox[2]!, bbox[1]!],
    [bbox[2]!, bbox[3]!],
    [bbox[0]!, bbox[3]!],
  ].map(([x, y]) => [a * x! + c * y! + e, b * x! + d * y! + f]);
  const xs = corners.map((p) => p[0]!);
  const ys = corners.map((p) => p[1]!);
  const tx0 = Math.min(...xs);
  const ty0 = Math.min(...ys);
  const tw = Math.max(...xs) - tx0 || 1;
  const th = Math.max(...ys) - ty0 || 1;
  const sx = (rect[2] - rect[0]) / tw;
  const sy = (rect[3] - rect[1]) / th;
  // A maps transformed-bbox space to page space at /Rect; we also shift Rect to origin.
  return [sx, 0, 0, sy, -tx0 * sx, -ty0 * sy];
}

export interface ApBitmap {
  canvas: HTMLCanvasElement;
  /** The `/Rect` the bitmap covers, in PDF user space. */
  rect: Rect;
}

const cache = new Map<string, Promise<ApBitmap | undefined>>();

/** Render a markup's normal appearance at `pixelsPerPoint`. Cached per markup and zoom. */
export function renderApBitmap(
  markup: Markup,
  pixelsPerPoint: number,
): Promise<ApBitmap | undefined> {
  const zoomKey = Math.round(pixelsPerPoint * 100);
  const key = `${markup.id}@${zoomKey}@${markup.rect.join(',')}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = build(markup, pixelsPerPoint).catch(() => undefined);
    cache.set(key, pending);
    if (cache.size > 400) cache.delete(cache.keys().next().value!);
  }
  return pending;
}

async function build(markup: Markup, pixelsPerPoint: number): Promise<ApBitmap | undefined> {
  const stream = normalAppearance(markup);
  if (!stream) return undefined;
  const rect = markup.rect;
  const width = rect[2] - rect[0];
  const height = rect[3] - rect[1];
  if (width <= 0 || height <= 0) return undefined;

  const bbox = numbers(stream.dict.lookup(PDFName.of('BBox')) as PDFArray | undefined, 4) ?? [
    0,
    0,
    width,
    height,
  ];
  const matrix = numbers(stream.dict.lookup(PDFName.of('Matrix')) as PDFArray | undefined, 6) ?? [
    1, 0, 0, 1, 0, 0,
  ];

  const tmp = await PDFDocument.create();
  const copier = PDFObjectCopier.for(markup.raw.context, tmp.context);
  const copied = copier.copy(stream);
  const formRef = tmp.context.register(copied);

  const page = tmp.addPage([width, height]);
  const xobjects = tmp.context.obj({}) as PDFDict;
  xobjects.set(PDFName.of('FX'), formRef);
  const resources = tmp.context.obj({}) as PDFDict;
  resources.set(PDFName.of('XObject'), xobjects);
  page.node.set(PDFName.of('Resources'), resources);
  const cm = placementMatrix(bbox, matrix, rect).map((n) => Number(n.toFixed(6)));
  const content = tmp.context.stream(`q ${cm.join(' ')} cm /FX Do Q`);
  page.node.set(PDFName.of('Contents'), tmp.context.register(content));

  const bytes = await tmp.save({ useObjectStreams: false });
  const handle = await loadPdfjs(bytes);
  try {
    const pdfPage = await handle.doc.getPage(1);
    const dpr = window.devicePixelRatio || 1;
    const viewport = pdfPage.getViewport({ scale: pixelsPerPoint * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    await pdfPage.render({
      canvas,
      canvasContext: ctx,
      viewport,
      annotationMode: AnnotationMode.DISABLE,
    }).promise;
    return { canvas, rect };
  } finally {
    await handle.destroy();
  }
}
