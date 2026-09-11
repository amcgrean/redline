/**
 * Stamps: text, image and PDF artwork embedded once and placed many times; dictionary
 * snapshot; rendered snapshot; rotation matrix; dynamic fields.
 */

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFStream, rgb } from '@cantoo/pdf-lib';
import { PNG } from 'pngjs';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import {
  addStamp,
  embedStampArtwork,
  placementRect,
  rectAt,
  stampMatrix,
  stampPages,
} from '../src/stamps/stamp.js';
import { bakeFields, formatStampDate, formatStampTime } from '../src/stamps/fields.js';
import { BUILTIN_STAMPS } from '../src/stamps/library.js';
import { moveMarkup } from '../src/annots/write.js';
import { lookupName, lookupText } from '../src/annots/dict.js';
import { blankArchD } from './helpers/synthetic.js';
import { serializeDict } from './helpers/serialize.js';
import { expectPngSnapshot, inkCoverage, renderPng } from './helpers/render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = join(HERE, '__snapshots__');
const NOW = new Date('2026-09-08T14:05:00-05:00');
const AUTHOR = 'Aaron McGrane';
const GREEN = { r: 0.13, g: 0.55, b: 0.13 };

function redPng(size = 4): Uint8Array {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i += 1) {
    png.data[i * 4] = 220;
    png.data[i * 4 + 1] = 30;
    png.data[i * 4 + 2] = 30;
    png.data[i * 4 + 3] = 255;
  }
  return new Uint8Array(PNG.sync.write(png));
}

async function bluePagePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const page = pdf.addPage([200, 100]);
  page.drawRectangle({ x: 10, y: 10, width: 180, height: 80, color: rgb(0.1, 0.3, 0.9) });
  return pdf.save({ useObjectStreams: false });
}

describe('fields', () => {
  it('bakes date, time, user and leaves unknown braces alone', () => {
    const out = bakeFields('{user} {date} {time} {text} {nope}', { now: NOW, user: 'Pat' });
    expect(out).toBe(`Pat ${formatStampDate(NOW)} ${formatStampTime(NOW)} {text} {nope}`);
    expect(formatStampDate(NOW)).toBe('09/08/2026');
    expect(formatStampTime(NOW)).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
    expect(bakeFields('{page}/{pages}', { now: NOW, user: '', page: 2, pageCount: 7 })).toBe('2/7');
  });

  it('every built-in stamp has a headline and a colour', () => {
    for (const s of BUILTIN_STAMPS) {
      expect(s.lines.length).toBeGreaterThan(0);
      expect(s.color.r + s.color.g + s.color.b).toBeGreaterThan(0);
    }
  });
});

describe('stampMatrix', () => {
  it('maps the artwork box into the rect, rotated clockwise', () => {
    expect(stampMatrix({ width: 200, height: 100 }, [0, 0, 200, 100], 0)).toEqual([
      1, 0, 0, 1, 0, 0,
    ]);
    expect(stampMatrix({ width: 200, height: 100 }, [0, 0, 400, 200], 0)).toEqual([
      2, 0, 0, 2, 0, 0,
    ]);
    expect(stampMatrix({ width: 200, height: 100 }, [0, 0, 100, 200], 90)).toEqual([
      0, -1, 1, 0, 0, 200,
    ]);
    expect(stampMatrix({ width: 200, height: 100 }, [0, 0, 200, 100], 180)).toEqual([
      -1, 0, 0, -1, 200, 100,
    ]);
  });
});

describe('addStamp', () => {
  it('writes a /Stamp with /Name, /Subj, /Contents and an /AP that draws the shared artwork', async () => {
    const doc = await openDocument(await blankArchD());
    const source = await embedStampArtwork(doc, {
      kind: 'text',
      lines: ['APPROVED', `${AUTHOR} · ${formatStampDate(NOW)}`],
      color: GREEN,
    });
    expect(source.width).toBeGreaterThan(100);
    const rect = rectAt(source, { x: 100, y: 1600 }, 300);
    const m = addStamp(doc, 0, rect, source, {
      name: 'RedlineApproved',
      contents: `APPROVED ${AUTHOR} · ${formatStampDate(NOW)}`,
      author: AUTHOR,
      now: NOW,
      nm: 'STAMPAAAAAAAAAAA',
    });
    expect(m.rawSubtype).toBe('Stamp');
    expect(m.render).toBe('ap-bitmap');
    expect(lookupName(m.raw, 'Name')).toBe('RedlineApproved');
    expect(lookupText(m.raw, 'Subj')).toBe('Stamp');
    expect(m.rect[0]).toBe(100);
    expect(m.rect[3]).toBe(1600);
    expect(m.rect[2] - m.rect[0]).toBe(300);
    await expect(
      serializeDict(m.raw, doc.pdfDoc.context, { depth: 4, streams: true }),
    ).toMatchFileSnapshot(join(SNAPSHOTS, 'stamp-text.txt'));

    // Reopen: still a stamp, still drawn.
    const bytes = (await saveIncremental(doc)).bytes;
    const back = await openDocument(bytes);
    expect(back.markups).toHaveLength(1);
    expect(back.markups[0]!.rawSubtype).toBe('Stamp');
    expect(back.markups[0]!.text?.contents).toContain('APPROVED');
    const png = await renderPng(bytes, { scale: 0.25, annotations: true });
    const plain = await renderPng(bytes, { scale: 0.25, annotations: false });
    expect(inkCoverage(png)).toBeGreaterThan(inkCoverage(plain));
  });

  it('image and PDF artwork embed, place, move, and render', async () => {
    const doc = await openDocument(await blankArchD());
    const image = await embedStampArtwork(doc, { kind: 'image', format: 'png', bytes: redPng() });
    expect([image.width, image.height]).toEqual([4, 4]);
    const logo = addStamp(doc, 0, rectAt(image, { x: 200, y: 1400 }, 200), image, {
      name: 'RedlineLogo',
      contents: 'logo',
      author: AUTHOR,
      now: NOW,
      opacity: 0.5,
    });
    expect(logo.rect).toEqual([200, 1200, 400, 1400]);
    expect(logo.style.opacity).toBe(0.5);

    const pdfArt = await embedStampArtwork(doc, { kind: 'pdf', bytes: await bluePagePdf() });
    expect([pdfArt.width, pdfArt.height]).toEqual([200, 100]);
    const blue = addStamp(doc, 0, rectAt(pdfArt, { x: 600, y: 1400 }, 400), pdfArt, {
      name: 'RedlineBlue',
      contents: 'blue',
      author: AUTHOR,
      now: NOW,
      rotation: 90,
    });
    expect(blue.rect).toEqual([600, 1200, 1000, 1400]);
    moveMarkup(doc, blue.id, 100, -100, NOW);
    expect(blue.rect).toEqual([700, 1100, 1100, 1300]);

    const bytes = (await saveIncremental(doc)).bytes;
    const png = await renderPng(bytes, { scale: 0.25, annotations: true });
    expectPngSnapshot(png, join(SNAPSHOTS, 'stamps-image-pdf.png'), 0.01);
  });

  it('stampPages places one artwork on every page, sharing the XObject', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.addPage([2592, 1728]);
    pdf.addPage([1728, 2592]);
    pdf.addPage([1224, 792]);
    const doc = await openDocument(await pdf.save({ useObjectStreams: false }));
    const source = await embedStampArtwork(doc, {
      kind: 'text',
      lines: ['RECEIVED', formatStampDate(NOW)],
      color: GREEN,
    });
    const marks = stampPages(
      doc,
      source,
      { corner: 'top-right', width: 150, margin: 36 },
      { name: 'RedlineReceived', contents: 'RECEIVED', author: AUTHOR, now: NOW },
    );
    expect(marks).toHaveLength(3);
    expect(marks.map((m) => m.pageIndex)).toEqual([0, 1, 2]);
    // Top-right of each page.
    expect(marks[0]!.rect[2]).toBe(2592 - 36);
    expect(marks[0]!.rect[3]).toBe(1728 - 36);
    expect(marks[1]!.rect[2]).toBe(1728 - 36);
    expect(marks[2]!.rect[3]).toBe(792 - 36);
    for (const m of marks) {
      const ap = m.raw.lookup(PDFName.of('AP'));
      expect(ap).toBeInstanceOf(PDFDict);
      const n = (ap as PDFDict).lookup(PDFName.of('N'));
      expect(n).toBeInstanceOf(PDFStream);
      const resources = (n as PDFStream).dict.lookup(PDFName.of('Resources'));
      expect(resources).toBeInstanceOf(PDFDict);
      const xobjects = (resources as PDFDict).lookup(PDFName.of('XObject'));
      expect(xobjects).toBeInstanceOf(PDFDict);
      expect((xobjects as PDFDict).get(PDFName.of('Fm0'))).toBe(source.ref);
    }
    const centred = placementRect(
      source,
      { width: 1000, height: 500 },
      { corner: 'center', width: 100 },
    );
    const half = (100 * source.height) / source.width / 2;
    expect(centred[0]).toBe(450);
    expect(centred[2]).toBe(550);
    expect(centred[1]).toBeCloseTo(250 - half, 5);
    expect(centred[3]).toBeCloseTo(250 + half, 5);
    const back = await openDocument((await saveIncremental(doc)).bytes);
    expect(back.markups.filter((m) => m.rawSubtype === 'Stamp')).toHaveLength(3);
  });
});
