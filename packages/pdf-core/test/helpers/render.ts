/**
 * Render PDF pages with pdf.js in Node for PNG snapshot tests.
 *
 * pdf.js draws annotation appearance streams itself when `annotationMode` is ENABLE,
 * which is exactly the path Chrome takes for our `/AP` — so a pixel snapshot here is a
 * meaningful check that the appearance renders, not just that it parses.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PNG } from 'pngjs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface RenderOptions {
  pageIndex?: number;
  scale?: number;
  /** Render annotations (our APs) or the page content only. */
  annotations?: boolean;
}

export interface PdfjsHandle {
  doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  /** Tear down the worker/transport; pdf.js 6 exposes this on the loading task. */
  destroy: () => Promise<void>;
}

/** Load with pdf.js; throws if pdf.js cannot parse the bytes. */
export async function loadWithPdfjs(bytes: Uint8Array): Promise<PdfjsHandle> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

/** Render one page to PNG bytes. */
export async function renderPng(bytes: Uint8Array, options: RenderOptions = {}): Promise<Buffer> {
  const { pageIndex = 0, scale = 0.25, annotations = true } = options;
  const handle = await loadWithPdfjs(bytes);
  try {
    const page = await handle.doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // pdf.js's types are written against the DOM; @napi-rs/canvas is API-compatible.
    type RenderParams = Parameters<typeof page.render>[0];
    await page.render({
      canvas: canvas as unknown as RenderParams['canvas'],
      canvasContext: ctx as unknown as RenderParams['canvasContext'],
      viewport,
      annotationMode: annotations ? pdfjs.AnnotationMode.ENABLE : pdfjs.AnnotationMode.DISABLE,
    }).promise;
    return canvas.toBuffer('image/png');
  } finally {
    await handle.destroy();
  }
}

export interface PixelDiff {
  width: number;
  height: number;
  /** Pixels whose max channel delta exceeds the threshold. */
  differing: number;
  ratio: number;
}

/** Compare two PNGs pixel-by-pixel. Different sizes count as fully different. */
export function diffPng(a: Buffer, b: Buffer, threshold = 32): PixelDiff {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) {
    return { width: pa.width, height: pa.height, differing: pa.width * pa.height, ratio: 1 };
  }
  let differing = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    const delta = Math.max(
      Math.abs(pa.data[i]! - pb.data[i]!),
      Math.abs(pa.data[i + 1]! - pb.data[i + 1]!),
      Math.abs(pa.data[i + 2]! - pb.data[i + 2]!),
    );
    if (delta > threshold) differing += 1;
  }
  const total = pa.width * pa.height;
  return { width: pa.width, height: pa.height, differing, ratio: differing / total };
}

/**
 * Snapshot helper: the first run writes the PNG; later runs compare against it and fail
 * when more than `tolerance` of pixels differ. Set `UPDATE_SNAPSHOTS=1` to rewrite.
 */
export function expectPngSnapshot(actual: Buffer, snapshotPath: string, tolerance = 0.002): void {
  const update = process.env['UPDATE_SNAPSHOTS'] === '1';
  if (update || !existsSync(snapshotPath)) {
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, actual);
    return;
  }
  const expected = readFileSync(snapshotPath);
  const diff = diffPng(expected, actual);
  if (diff.ratio > tolerance) {
    const failPath = snapshotPath.replace(/\.png$/, '.actual.png');
    writeFileSync(failPath, actual);
    throw new Error(
      `PNG snapshot mismatch for ${snapshotPath}: ${diff.differing}/${diff.width * diff.height} ` +
        `pixels differ (${(diff.ratio * 100).toFixed(2)}%). Actual written to ${failPath}.`,
    );
  }
}

/** Count non-white pixels — a cheap "did anything draw?" assertion. */
export function inkCoverage(png: Buffer): number {
  const p = PNG.sync.read(png);
  let ink = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    if (p.data[i]! < 240 || p.data[i + 1]! < 240 || p.data[i + 2]! < 240) ink += 1;
  }
  return ink;
}
