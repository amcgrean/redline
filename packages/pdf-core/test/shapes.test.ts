/**
 * Plain shapes: rectangle, ellipse, line, arrow, polyline, polygon, pen.
 */

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PDFName } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { addShapeMarkup } from '../src/annots/shapes.js';
import {
  moveMarkup,
  setMarkupGeometry,
  updateMarkupProperties,
  canRegenerateAppearance,
} from '../src/annots/write.js';
import { lookupName } from '../src/annots/dict.js';
import { blankArchD } from './helpers/synthetic.js';
import { changedKeys, keyMap, serializeDict } from './helpers/serialize.js';
import { expectPngSnapshot, inkCoverage, renderPng } from './helpers/render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = join(HERE, '__snapshots__');
const NOW = new Date('2026-09-08T10:15:00-05:00');
const AUTHOR = 'Aaron McGrane';
const opts = { subject: 'Note', author: AUTHOR, now: NOW };
const SNAPSHOT_OPTIONS = { depth: 4, streams: true } as const;

describe('addShapeMarkup', () => {
  it('writes each subtype with /AP and no /Measure (rectangle snapshot)', async () => {
    const doc = await openDocument(await blankArchD());
    const rect = addShapeMarkup(
      doc,
      0,
      { kind: 'rectangle', rect: [100, 100, 400, 300] },
      {
        ...opts,
        nm: 'RECTANGLEABCDEFG',
        style: { fill: { r: 1, g: 0.9, b: 0 }, fillOpacity: 0.3 },
      },
    );
    expect(rect.rawSubtype).toBe('Square');
    expect(rect.rect).toEqual([100, 100, 400, 300]);
    expect(rect.raw.has(PDFName.of('Measure'))).toBe(false);
    expect(rect.raw.has(PDFName.of('IT'))).toBe(false);
    await expect(serializeDict(rect.raw, doc.pdfDoc.context, SNAPSHOT_OPTIONS)).toMatchFileSnapshot(
      './__snapshots__/shape-rectangle.txt',
    );

    const kinds = [
      addShapeMarkup(doc, 0, { kind: 'ellipse', rect: [500, 100, 800, 300] }, opts),
      addShapeMarkup(
        doc,
        0,
        { kind: 'line', start: { x: 900, y: 100 }, end: { x: 1200, y: 300 } },
        opts,
      ),
      addShapeMarkup(
        doc,
        0,
        { kind: 'arrow', start: { x: 900, y: 400 }, end: { x: 1200, y: 600 } },
        opts,
      ),
      addShapeMarkup(
        doc,
        0,
        {
          kind: 'polyline',
          points: [
            { x: 100, y: 500 },
            { x: 300, y: 700 },
            { x: 500, y: 500 },
          ],
        },
        opts,
      ),
      addShapeMarkup(
        doc,
        0,
        {
          kind: 'polygon',
          points: [
            { x: 600, y: 500 },
            { x: 800, y: 700 },
            { x: 1000, y: 500 },
          ],
        },
        opts,
      ),
      addShapeMarkup(
        doc,
        0,
        {
          kind: 'pen',
          paths: [
            [
              { x: 100, y: 900 },
              { x: 150, y: 950 },
              { x: 220, y: 910 },
            ],
            [{ x: 300, y: 900 }],
          ],
        },
        opts,
      ),
    ];
    expect(kinds.map((m) => m.rawSubtype)).toEqual([
      'Circle',
      'Line',
      'Line',
      'PolyLine',
      'Polygon',
      'Ink',
    ]);
    expect(lookupName(kinds[2]!.raw, 'IT')).toBe('LineArrow');
    expect(kinds[1]!.raw.has(PDFName.of('IT'))).toBe(false);
    for (const m of kinds) {
      expect(m.raw.has(PDFName.of('AP'))).toBe(true);
      expect(m.raw.has(PDFName.of('Measure'))).toBe(false);
      expect(canRegenerateAppearance(m)).toBe(true);
    }

    const { bytes } = await saveIncremental(doc);
    const back = await openDocument(bytes);
    expect(back.markups.map((m) => m.rawSubtype)).toEqual([
      'Square',
      'Circle',
      'Line',
      'Line',
      'PolyLine',
      'Polygon',
      'Ink',
    ]);
    expect(back.markups.every((m) => m.render === 'native')).toBe(true);
  });

  it('restyle and resize regenerate the appearance; move keeps it', async () => {
    const doc = await openDocument(await blankArchD());
    const rect = addShapeMarkup(doc, 0, { kind: 'rectangle', rect: [100, 100, 400, 300] }, opts);
    const ap0 = rect.raw.get(PDFName.of('AP'))?.toString();

    updateMarkupProperties(doc, rect.id, { stroke: { r: 0, g: 0, b: 1 }, width: 4 });
    const ap1 = rect.raw.get(PDFName.of('AP'))?.toString();
    expect(ap1).not.toBe(ap0);

    const before = keyMap(rect.raw, doc.pdfDoc.context);
    setMarkupGeometry(
      doc,
      rect.id,
      { kind: 'rect', rect: [100, 100, 700, 500] },
      new Date('2026-09-08T12:00:00-05:00'),
    );
    const after = keyMap(rect.raw, doc.pdfDoc.context);
    expect(changedKeys(before, after).sort()).toEqual(['AP', 'M', 'Rect']);
    expect(rect.rect).toEqual([100, 100, 700, 500]);

    const ap2 = rect.raw.get(PDFName.of('AP'))?.toString();
    moveMarkup(doc, rect.id, 10, 10);
    expect(rect.raw.get(PDFName.of('AP'))?.toString()).toBe(ap2);
    expect(rect.rect).toEqual([110, 110, 710, 510]);
  });
});

describe('shape appearances render in pdf.js', () => {
  it('draws every shape kind', async () => {
    const doc = await openDocument(await blankArchD());
    addShapeMarkup(
      doc,
      0,
      { kind: 'rectangle', rect: [200, 900, 700, 1300] },
      { ...opts, style: { fill: { r: 1, g: 0.85, b: 0.2 }, fillOpacity: 0.35, width: 3 } },
    );
    addShapeMarkup(
      doc,
      0,
      { kind: 'ellipse', rect: [800, 900, 1300, 1300] },
      { ...opts, style: { stroke: { r: 0, g: 0.4, b: 0.8 }, width: 3, dash: [10, 5] } },
    );
    addShapeMarkup(
      doc,
      0,
      { kind: 'arrow', start: { x: 1400, y: 950 }, end: { x: 2000, y: 1250 } },
      {
        ...opts,
        style: { width: 4 },
      },
    );
    addShapeMarkup(
      doc,
      0,
      {
        kind: 'polygon',
        points: [
          { x: 300, y: 300 },
          { x: 700, y: 700 },
          { x: 900, y: 350 },
          { x: 600, y: 200 },
        ],
      },
      {
        ...opts,
        style: {
          stroke: { r: 0.1, g: 0.6, b: 0.2 },
          fill: { r: 0.1, g: 0.6, b: 0.2 },
          fillOpacity: 0.2,
        },
      },
    );
    addShapeMarkup(
      doc,
      0,
      {
        kind: 'pen',
        paths: [
          Array.from({ length: 30 }, (_, i) => ({
            x: 1100 + i * 30,
            y: 500 + Math.sin(i / 3) * 120,
          })),
        ],
      },
      { ...opts, style: { stroke: { r: 0.6, g: 0, b: 0.6 }, width: 5, opacity: 0.8 } },
    );
    const { bytes } = await saveIncremental(doc);
    const withAnnots = await renderPng(bytes, { scale: 0.25, annotations: true });
    const without = await renderPng(bytes, { scale: 0.25, annotations: false });
    expect(inkCoverage(withAnnots)).toBeGreaterThan(inkCoverage(without) + 500);
    expectPngSnapshot(withAnnots, join(SNAPSHOTS, 'ap-shapes.png'));
  });
});
