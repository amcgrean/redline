/**
 * Image inventory and replacement for Reduce-images.
 */

import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFStream } from '@cantoo/pdf-lib';
import { PNG } from 'pngjs';
import { openDocument } from '../src/document/open.js';
import { downsampleTarget, listImages, replaceImageWithJpeg } from '../src/compress/images.js';
import { saveFull } from '../src/pages/ops.js';

/** A minimal baseline JPEG (1×1, gray) so tests need no encoder. */
const TINY_JPEG = new Uint8Array(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64',
  ),
);

function noisePng(width: number, height: number): Uint8Array {
  const png = new PNG({ width, height });
  let seed = 7;
  for (let i = 0; i < width * height * 4; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    png.data[i] = i % 4 === 3 ? 255 : seed & 0xff;
  }
  return new Uint8Array(PNG.sync.write(png));
}

/** Letter page carrying one 1700×2200 image (200 dpi) and a small logo. */
async function scanLike(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const page = pdf.addPage([612, 792]);
  const big = await pdf.embedPng(noisePng(1700, 2200));
  page.drawImage(big, { x: 0, y: 0, width: 612, height: 792 });
  const logo = await pdf.embedPng(noisePng(100, 50));
  page.drawImage(logo, { x: 20, y: 700, width: 100, height: 50 });
  const page2 = pdf.addPage([612, 792]);
  page2.drawImage(big, { x: 0, y: 0, width: 612, height: 792 });
  return pdf.save({ useObjectStreams: false });
}

describe('listImages', () => {
  it('finds each image once with its pages, size and estimated dpi', async () => {
    const doc = await openDocument(await scanLike());
    const images = listImages(doc).sort((a, b) => b.width - a.width);
    expect(images).toHaveLength(2);
    const [big, logo] = images;
    expect([big!.width, big!.height]).toEqual([1700, 2200]);
    expect(big!.pages).toEqual([0, 1]);
    expect(big!.dpi).toBe(200);
    expect(big!.colorSpace).toBe('DeviceRGB');
    expect(big!.filters).toEqual(['FlateDecode']);
    expect(big!.replaceable).toBe(true);
    expect(big!.bytes).toBeGreaterThan(100_000);
    expect(logo!.pages).toEqual([0]);
    expect(logo!.dpi).toBe(Math.round(Math.min(100 / 8.5, 50 / 11)));
  });

  it('flags masked images as not replaceable', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    const page = pdf.addPage([200, 200]);
    const img = await pdf.embedPng(noisePng(40, 40));
    page.drawImage(img, { x: 0, y: 0, width: 200, height: 200 });
    const doc = await openDocument(await pdf.save({ useObjectStreams: false }));
    const [info] = listImages(doc);
    const stream = doc.pdfDoc.context.lookup(info!.ref);
    expect(stream).toBeInstanceOf(PDFStream);
    (stream as PDFStream).dict.set(PDFName.of('SMask'), PDFName.of('Fake'));
    expect(listImages(doc)[0]!.replaceable).toBe(false);
  });
});

describe('downsampleTarget', () => {
  it('shrinks only above the target dpi', () => {
    expect(downsampleTarget({ width: 1700, height: 2200, dpi: 200 }, 200)).toBeUndefined();
    expect(downsampleTarget({ width: 1700, height: 2200, dpi: 400 }, 200)).toEqual({
      width: 850,
      height: 1100,
    });
    expect(downsampleTarget({ width: 10, height: 10, dpi: 0 }, 200)).toBeUndefined();
  });
});

describe('replaceImageWithJpeg', () => {
  it('keeps the object number so every page draws the new image', async () => {
    const doc = await openDocument(await scanLike());
    const before = await saveFull(doc);
    const big = listImages(doc).sort((a, b) => b.width - a.width)[0]!;
    const result = await replaceImageWithJpeg(doc, big.ref, TINY_JPEG);
    expect(result.width).toBe(1);
    const after = await saveFull(doc);
    expect(after.length).toBeLessThan(before.length / 2);
    const back = await openDocument(after);
    const images = listImages(back).sort((a, b) => b.width - a.width);
    const swapped = images.find((i) => i.ref.toString() === big.ref.toString())!;
    expect(swapped.filters).toEqual(['DCTDecode']);
    expect(swapped.pages).toEqual([0, 1]);
    expect([swapped.width, swapped.height]).toEqual([1, 1]);
  });
});
