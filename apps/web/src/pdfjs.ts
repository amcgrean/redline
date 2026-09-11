/**
 * pdf.js setup for the browser. pdf.js only READS here (CLAUDE.md #1); every byte that
 * goes back to disk comes from pdf-core / pdf-lib.
 */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfjsDocument = pdfjs.PDFDocumentProxy;
export type PdfjsPage = pdfjs.PDFPageProxy;
export type PageViewport = pdfjs.PageViewport;

export const AnnotationMode = pdfjs.AnnotationMode;

export interface PdfjsHandle {
  doc: PdfjsDocument;
  /** pdf.js 6 tears down through the loading task, not the document proxy. */
  destroy: () => Promise<void>;
}

export async function loadPdfjs(bytes: Uint8Array): Promise<PdfjsHandle> {
  // pdf.js transfers the buffer to its worker; hand it a copy so pdf-core keeps the original.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

/** Safari's canvas cap is 16.7 Mpx; keep every canvas comfortably under it (PLAN §3.5). */
export const MAX_CANVAS_PIXELS = 16_000_000;
/** Tile edge in device pixels. 2048² = 4.2 Mpx per tile. */
export const TILE_SIZE = 2048;

export interface Tile {
  /** Tile origin in CSS pixels within the page. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Split a page of `width` x `height` CSS pixels into tiles no larger than TILE_SIZE device px. */
export function tilesFor(width: number, height: number, dpr: number): Tile[] {
  const tileCss = Math.floor(TILE_SIZE / dpr);
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += tileCss) {
    for (let x = 0; x < width; x += tileCss) {
      tiles.push({
        x,
        y,
        width: Math.min(tileCss, width - x),
        height: Math.min(tileCss, height - y),
      });
    }
  }
  return tiles;
}

/**
 * Render one tile of a page into `canvas`. The viewport is the FULL page at the current
 * zoom; the render transform shifts it so the tile's region lands at the canvas origin.
 */
export interface TileRender {
  promise: Promise<void>;
  /** Abort a render whose zoom/rotation is already stale; its promise rejects. */
  cancel: () => void;
}

export function renderTile(
  page: PdfjsPage,
  viewport: PageViewport,
  tile: Tile,
  dpr: number,
  canvas: HTMLCanvasElement,
): TileRender {
  canvas.width = Math.ceil(tile.width * dpr);
  canvas.height = Math.ceil(tile.height * dpr);
  canvas.style.width = `${tile.width}px`;
  canvas.style.height = `${tile.height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { promise: Promise.resolve(), cancel: () => undefined };
  const task = page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    transform: [dpr, 0, 0, dpr, -tile.x * dpr, -tile.y * dpr],
    // Redline draws every markup itself so the view matches what will be saved.
    annotationMode: AnnotationMode.DISABLE,
  });
  return { promise: task.promise, cancel: () => task.cancel() };
}
