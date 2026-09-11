/**
 * Compress — Reduce images (PLAN §3.9): every replaceable image XObject is decoded by
 * pdf.js (drawn alone in a throw-away one-page PDF, the same trick as the AP bitmap),
 * downsampled to the target DPI on a canvas, re-encoded as JPEG, and swapped back under
 * its original object number. The document is then rewritten and passed through qpdf
 * Optimize so the old image bytes leave the file. Vector content and text are untouched.
 */

import { PDFDocument, PDFName, PDFObjectCopier, PDFStream, type PDFDict } from '@cantoo/pdf-lib';
import {
  downsampleTarget,
  listImages,
  openDocument,
  optimizePdf,
  replaceImageWithJpeg,
  saveFull,
  type ImageInfo,
  type OptimizeReport,
  type RedlineDocument,
} from '@redline/pdf-core';
import { loadPdfjs } from './pdfjs';
import { workerQpdf } from './compress';

export interface ReduceOptions {
  /** Target resolution for images that exceed it. */
  dpi: number;
  /** JPEG quality 0..1. */
  quality: number;
}

export interface ReduceReport extends OptimizeReport {
  /** Images re-encoded. */
  images: number;
  /** Images left alone (masked, already small JPEGs, or re-encoding would not shrink them). */
  skipped: number;
}

/** Canvas area we are willing to allocate for one image (a 36×24 sheet at 300 dpi is 78 Mpx). */
const MAX_PIXELS = 60_000_000;

export async function reduceImages(
  bytes: Uint8Array,
  options: ReduceOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<ReduceReport> {
  const doc = await openDocument(bytes);
  const images = listImages(doc);
  let done = 0;
  let skipped = 0;
  for (const [index, info] of images.entries()) {
    onProgress?.(index, images.length);
    if (!info.replaceable) {
      skipped += 1;
      continue;
    }
    const target = downsampleTarget(info, options.dpi);
    const alreadyJpeg = info.filters.includes('DCTDecode');
    if (!target && alreadyJpeg) {
      skipped += 1; // small enough and already lossy: nothing to gain
      continue;
    }
    const size = target ?? { width: info.width, height: info.height };
    if (size.width * size.height > MAX_PIXELS) {
      skipped += 1;
      continue;
    }
    const jpeg = await renderImageToJpeg(doc, info, size, options.quality);
    if (!jpeg || jpeg.length >= info.bytes) {
      skipped += 1; // never make an image bigger
      continue;
    }
    await replaceImageWithJpeg(doc, info.ref, jpeg);
    done += 1;
  }
  onProgress?.(images.length, images.length);
  const rewritten = await saveFull(doc);
  const optimized = await optimizePdf(workerQpdf, rewritten);
  return {
    ...optimized,
    before: bytes.length,
    saved: bytes.length > 0 ? 1 - optimized.after / bytes.length : 0,
    images: done,
    skipped,
  };
}

/** Decode one image through pdf.js at `size` pixels and encode it as JPEG. */
async function renderImageToJpeg(
  doc: RedlineDocument,
  info: ImageInfo,
  size: { width: number; height: number },
  quality: number,
): Promise<Uint8Array | undefined> {
  const source = doc.pdfDoc.context.lookup(info.ref);
  if (!(source instanceof PDFStream)) return undefined;

  const tmp = await PDFDocument.create();
  const copier = PDFObjectCopier.for(doc.pdfDoc.context, tmp.context);
  const imageRef = tmp.context.register(copier.copy(source));
  const page = tmp.addPage([size.width, size.height]);
  const xobjects = tmp.context.obj({}) as PDFDict;
  xobjects.set(PDFName.of('Im'), imageRef);
  const resources = tmp.context.obj({}) as PDFDict;
  resources.set(PDFName.of('XObject'), xobjects);
  page.node.set(PDFName.of('Resources'), resources);
  const content = tmp.context.stream(`q ${size.width} 0 0 ${size.height} 0 0 cm /Im Do Q`);
  page.node.set(PDFName.of('Contents'), tmp.context.register(content));
  const bytes = await tmp.save({ useObjectStreams: false });

  const handle = await loadPdfjs(bytes);
  try {
    const p = await handle.doc.getPage(1);
    const viewport = p.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    canvas.width = 0;
    canvas.height = 0;
    return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
  } finally {
    await handle.destroy();
  }
}
