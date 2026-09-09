/**
 * Polylength and perimeter: `/PolyLine` + `/IT /PolyLineDimension`.
 *
 * VERIFIED shape: the Revu fixture's object 115 is exactly this — `/Subtype/PolyLine`,
 * `/IT/PolyLineDimension`, `/Vertices`, `/Cap true`, its own `/Measure`. ASSUMED: a
 * perimeter is the same annotation with the first vertex repeated (Acrobat's convention).
 */

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PDFNumber } from '@cantoo/pdf-lib';
import { PDFArray, PDFName } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { setPageScale } from '../src/measure/viewport.js';
import { addPolylineMeasurement, moveMarkup } from '../src/annots/write.js';
import { lookupText } from '../src/annots/dict.js';
import { blankArchD } from './helpers/synthetic.js';
import { changedKeys, keyMap, serializeDict } from './helpers/serialize.js';
import { expectPngSnapshot, inkCoverage, renderPng } from './helpers/render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = join(HERE, '__snapshots__');

const EIGHTH_INCH = { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const FT_IN_16 = { display: 'ft-in', precision: 16 } as const;
const NOW = new Date('2026-09-08T10:15:00-05:00');
const AUTHOR = 'Aaron McGrane';
const SNAPSHOT_OPTIONS = { depth: 4, streams: true } as const;

/** An L-shaped run: 720 pt right then 360 pt up = 80' + 40' at 1/8" = 1'. */
const L_RUN = [
  { x: 100, y: 100 },
  { x: 820, y: 100 },
  { x: 820, y: 460 },
];

async function calibratedBlank() {
  const doc = await openDocument(await blankArchD());
  setPageScale(doc, 0, EIGHTH_INCH, FT_IN_16);
  return doc;
}

function vertexCount(dict: Parameters<typeof lookupText>[0]): number {
  const v = dict.lookup(PDFName.of('Vertices'));
  return v instanceof PDFArray ? v.size() / 2 : 0;
}

describe('addPolylineMeasurement', () => {
  it('writes a polylength of 120 ft for the L-run (snapshot)', async () => {
    const doc = await calibratedBlank();
    const markup = addPolylineMeasurement(doc, 0, L_RUN, {
      subject: 'Base Trim',
      author: AUTHOR,
      now: NOW,
      nm: 'PLNRUNABCDEFGHIJ',
    });
    expect(markup.subtype).toBe('PolyLine');
    expect(markup.intent).toBe('PolyLineDimension');
    expect(markup.text?.contents).toBe(`120'-0"`);
    expect(markup.measure?.computed.length).toBeCloseTo(120, 6);
    expect(vertexCount(markup.raw)).toBe(3);
    await expect(
      serializeDict(markup.raw, doc.pdfDoc.context, SNAPSHOT_OPTIONS),
    ).toMatchFileSnapshot('./__snapshots__/polyline-120ft.txt');
  });

  it('perimeter closes the run and measures the whole loop', async () => {
    const doc = await calibratedBlank();
    // 30 x 20 ft room: perimeter 100 ft.
    const room = [
      { x: 100, y: 100 },
      { x: 370, y: 100 },
      { x: 370, y: 280 },
      { x: 100, y: 280 },
    ];
    const markup = addPolylineMeasurement(doc, 0, room, {
      subject: 'Perimeter',
      author: AUTHOR,
      now: NOW,
      nm: 'PERIMETERABCDEFG',
      closed: true,
    });
    expect(markup.text?.contents).toBe(`100'-0"`);
    expect(vertexCount(markup.raw)).toBe(5);
    const v = markup.raw.lookup(PDFName.of('Vertices')) as PDFArray;
    expect((v.lookup(0) as PDFNumber).asNumber()).toBe((v.lookup(8) as PDFNumber).asNumber());
    expect((v.lookup(1) as PDFNumber).asNumber()).toBe((v.lookup(9) as PDFNumber).asNumber());
    await expect(
      serializeDict(markup.raw, doc.pdfDoc.context, SNAPSHOT_OPTIONS),
    ).toMatchFileSnapshot('./__snapshots__/perimeter-100ft.txt');
  });

  it('survives save and reopen with the same value', async () => {
    const doc = await calibratedBlank();
    addPolylineMeasurement(doc, 0, L_RUN, { subject: 'Run', author: AUTHOR, now: NOW });
    const { bytes } = await saveIncremental(doc);
    const reopened = await openDocument(bytes);
    const back = reopened.markups[0]!;
    expect(back.subtype).toBe('PolyLine');
    expect(back.geometry.kind === 'poly' && !back.geometry.closed).toBe(true);
    // /X /C is stored to 7 significant digits, so the reread value is within 1e-4 ft.
    expect(back.measure?.computed.length).toBeCloseTo(120, 3);
    expect(lookupText(back.raw, 'Contents')).toBe(`120'-0"`);
  });

  it('moves like any measurement: geometry, /Rect, /AP, /M only', async () => {
    const doc = await calibratedBlank();
    const markup = addPolylineMeasurement(doc, 0, L_RUN, {
      subject: 'Run',
      author: AUTHOR,
      now: NOW,
    });
    const before = keyMap(markup.raw, doc.pdfDoc.context);
    moveMarkup(doc, markup.id, 10, 10, new Date('2026-09-08T11:00:00-05:00'));
    const after = keyMap(markup.raw, doc.pdfDoc.context);
    expect(changedKeys(before, after).sort()).toEqual(['AP', 'M', 'Rect', 'Vertices']);
    expect(markup.text?.contents).toBe(`120'-0"`);
  });

  it('rejects fewer than two vertices', async () => {
    const doc = await calibratedBlank();
    expect(() =>
      addPolylineMeasurement(doc, 0, [{ x: 1, y: 1 }], { subject: 'x', author: AUTHOR }),
    ).toThrow(RangeError);
  });
});

describe('polyline appearance renders in pdf.js', () => {
  it('open run with slashes, a dashed perimeter, and captions', async () => {
    const doc = await calibratedBlank();
    addPolylineMeasurement(
      doc,
      0,
      [
        { x: 300, y: 1300 },
        { x: 900, y: 1300 },
        { x: 900, y: 900 },
        { x: 1500, y: 900 },
      ],
      { subject: 'Run', author: AUTHOR, now: NOW, style: { lineEnds: ['Slash', 'Slash'] } },
    );
    addPolylineMeasurement(
      doc,
      0,
      [
        { x: 1700, y: 400 },
        { x: 2300, y: 400 },
        { x: 2300, y: 1000 },
        { x: 1700, y: 1000 },
      ],
      {
        subject: 'Perimeter',
        author: AUTHOR,
        now: NOW,
        closed: true,
        style: { dash: [8, 4], stroke: { r: 0.1, g: 0.5, b: 0.2 }, width: 3 },
      },
    );
    const { bytes } = await saveIncremental(doc);
    const withAnnots = await renderPng(bytes, { scale: 0.25, annotations: true });
    const without = await renderPng(bytes, { scale: 0.25, annotations: false });
    expect(inkCoverage(withAnnots)).toBeGreaterThan(inkCoverage(without) + 500);
    expectPngSnapshot(withAnnots, join(SNAPSHOTS, 'ap-polyline.png'));
  });
});
