/**
 * Export a page as PNG (PLAN §3.10). The current bytes (unsaved markups included) are
 * rendered by pdf.js with annotations enabled, so every markup appears through its own
 * appearance stream, exactly as Chrome or Acrobat would draw it.
 */

import type { RedlineDocument } from '@redline/pdf-core';
import { saveIncremental } from '@redline/pdf-core';
import { AnnotationMode, loadPdfjs, type PdfjsHandle } from './pdfjs';

/** Keep a single export canvas under this many pixels (Chrome's practical ceiling is higher). */
const MAX_PIXELS = 40_000_000;

export interface PageRender {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** The scale actually used (may be lower than asked when the pixel cap applied). */
  scale: number;
}

/** Render one page (1-based number) of an open pdf.js document at `scale` × 72 dpi. */
export async function renderPageCanvas(
  handle: PdfjsHandle,
  pageNumber: number,
  scale: number,
): Promise<PageRender> {
  const page = await handle.doc.getPage(pageNumber);
  let viewport = page.getViewport({ scale });
  let used = scale;
  if (viewport.width * viewport.height > MAX_PIXELS) {
    used = scale * Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height));
    viewport = page.getViewport({ scale: used });
  }
  const canvas = document.createElement('canvas');
  // Round, not ceil: 480 pt × 150/72 is 1000 up to floating-point noise.
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    annotationMode: AnnotationMode.ENABLE,
  }).promise;
  return { canvas, width: canvas.width, height: canvas.height, scale: used };
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('PNG encode failed'));
        return;
      }
      void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)));
    }, 'image/png');
  });
}

/** PNG bytes of `pageIndex` at `dpi`, from the document's current state. */
export async function renderPagePng(
  doc: RedlineDocument,
  pageIndex: number,
  dpi: number,
): Promise<{ png: Uint8Array; width: number; height: number }> {
  const { bytes } = await saveIncremental(doc);
  const handle = await loadPdfjs(bytes);
  try {
    const render = await renderPageCanvas(handle, pageIndex + 1, dpi / 72);
    const png = await canvasToPng(render.canvas);
    render.canvas.width = 0;
    render.canvas.height = 0;
    return { png, width: render.width, height: render.height };
  } finally {
    await handle.destroy();
  }
}
