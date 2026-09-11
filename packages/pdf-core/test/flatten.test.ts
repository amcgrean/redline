/**
 * Flatten: markups become page content drawn from their own appearance streams; the
 * flattened page renders the same as the annotated one; hidden annotations vanish.
 */

import { describe, expect, it } from 'vitest';
import { PDFName, PDFNumber } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { setPageScale } from '../src/measure/viewport.js';
import { addLengthMeasurement } from '../src/annots/write.js';
import { addTextBox } from '../src/annots/text.js';
import { addShapeMarkup } from '../src/annots/shapes.js';
import { addStamp, embedStampArtwork, rectAt } from '../src/stamps/stamp.js';
import { appearanceMatrix, flattenMarkups } from '../src/pages/flatten.js';
import { saveFull } from '../src/pages/ops.js';
import { saveIncremental } from '../src/document/save.js';
import { blankArchD } from './helpers/synthetic.js';
import { diffPng, inkCoverage, renderPng } from './helpers/render.js';

const EIGHTH = { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const FTIN16 = { display: 'ft-in', precision: 16 } as const;
const NOW = new Date('2026-09-08T10:15:00-05:00');
const AUTHOR = 'Aaron McGrane';

async function annotated() {
  const doc = await openDocument(await blankArchD());
  setPageScale(doc, 0, EIGHTH, FTIN16);
  addLengthMeasurement(
    doc,
    0,
    { x: 200, y: 300 },
    { x: 1200, y: 300 },
    {
      subject: 'Wall',
      author: AUTHOR,
      now: NOW,
    },
  );
  addTextBox(doc, 0, [200, 900, 700, 1000], {
    subject: 'Text',
    author: AUTHOR,
    text: 'Flatten me',
    now: NOW,
  });
  addShapeMarkup(
    doc,
    0,
    { kind: 'rectangle', rect: [1400, 600, 2200, 1200] },
    {
      subject: 'Rectangle',
      author: AUTHOR,
      now: NOW,
      style: { fill: { r: 1, g: 0.9, b: 0.2 }, fillOpacity: 0.5 },
    },
  );
  const art = await embedStampArtwork(doc, {
    kind: 'text',
    lines: ['APPROVED'],
    color: { r: 0.13, g: 0.55, b: 0.13 },
  });
  addStamp(doc, 0, rectAt(art, { x: 1500, y: 1600 }, 300), art, {
    name: 'RedlineApproved',
    contents: 'APPROVED',
    author: AUTHOR,
    now: NOW,
  });
  return doc;
}

describe('appearanceMatrix', () => {
  it('is the identity when BBox already equals Rect', () => {
    expect(appearanceMatrix([10, 20, 110, 70], [1, 0, 0, 1, 0, 0], [10, 20, 110, 70])).toEqual([
      1, 0, 0, 1, 0, 0,
    ]);
  });
  it('scales and translates a form-space box onto the rect', () => {
    expect(appearanceMatrix([0, 0, 100, 50], [1, 0, 0, 1, 0, 0], [200, 300, 400, 400])).toEqual([
      2, 0, 0, 2, 200, 300,
    ]);
  });
  it('accounts for the form matrix', () => {
    // A 90° matrix turns a 100×50 box into a 50×100 one; fitted to a 50×100 rect at (0,0).
    const m = appearanceMatrix([0, 0, 100, 50], [0, 1, -1, 0, 50, 0], [0, 0, 50, 100]);
    expect(m).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe('flattenMarkups', () => {
  it('bakes every markup into the page and removes the annotations', async () => {
    const doc = await annotated();
    const before = await renderPng((await saveIncremental(doc)).bytes, {
      scale: 0.25,
      annotations: true,
    });
    expect(flattenMarkups(doc)).toBe(4);
    expect(doc.markups).toHaveLength(0);
    const bytes = await saveFull(doc);
    const back = await openDocument(bytes);
    expect(back.markups).toHaveLength(0);
    expect(back.pdfDoc.getPage(0).node.Annots()).toBeUndefined();
    // Page content alone now draws what the annotations drew.
    const after = await renderPng(bytes, { scale: 0.25, annotations: false });
    expect(inkCoverage(after)).toBeGreaterThan(0.001);
    const diff = diffPng(before, after);
    expect(diff.ratio).toBeLessThan(0.002);
  });

  it('flattens only the given ids and drops hidden annotations without drawing', async () => {
    const doc = await annotated();
    const wall = doc.markups.find((m) => m.text?.subject === 'Wall')!;
    const text = doc.markups.find((m) => m.text?.subject === 'Text')!;
    // Hide the text box: flattening removes it but draws nothing for it.
    text.raw.set(PDFName.of('F'), PDFNumber.of(4 | 2));
    expect(flattenMarkups(doc, { ids: [wall.id, text.id] })).toBe(2);
    const back = await openDocument(await saveFull(doc));
    expect(back.markups.map((m) => m.text?.subject).sort()).toEqual(['Rectangle', 'Stamp']);
    const content = back.pdfDoc.getPage(0).node.Contents();
    expect(content).toBeDefined();
  });
});
