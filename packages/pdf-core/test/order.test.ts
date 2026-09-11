/**
 * Hide/show, z-order, and measurement caption toggle.
 */

import { describe, expect, it } from 'vitest';
import { PDFName } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { setPageScale } from '../src/measure/viewport.js';
import { addLengthMeasurement, setMeasurementCaption } from '../src/annots/write.js';
import { addShapeMarkup } from '../src/annots/shapes.js';
import { reorderMarkup, setMarkupHidden } from '../src/annots/order.js';
import { blankArchD } from './helpers/synthetic.js';
import { inkCoverage, renderPng } from './helpers/render.js';

const EIGHTH = { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const FTIN16 = { display: 'ft-in', precision: 16 } as const;

describe('hide and z-order', () => {
  it('sets and clears the Hidden flag, keeping Print', async () => {
    const doc = await openDocument(await blankArchD());
    const m = addShapeMarkup(
      doc,
      0,
      { kind: 'rectangle', rect: [0, 0, 100, 100] },
      {
        subject: 'Box',
        author: 'T',
      },
    );
    setMarkupHidden(doc, m.id, true);
    expect(m.flags.hidden).toBe(true);
    let back = await openDocument((await saveIncremental(doc)).bytes);
    expect(back.markups[0]!.flags.hidden).toBe(true);
    expect(back.markups[0]!.flags.print).toBe(true);
    setMarkupHidden(doc, m.id, false);
    back = await openDocument((await saveIncremental(doc)).bytes);
    expect(back.markups[0]!.flags.hidden).toBe(false);
  });

  it('moves a markup to the front or back of /Annots and the model', async () => {
    const doc = await openDocument(await blankArchD());
    const ids = ['A', 'B', 'C'].map(
      (s) =>
        addShapeMarkup(
          doc,
          0,
          { kind: 'rectangle', rect: [0, 0, 100, 100] },
          {
            subject: s,
            author: 'T',
          },
        ).id,
    );
    reorderMarkup(doc, ids[0]!, 'front');
    expect(doc.markups.map((m) => m.text?.subject)).toEqual(['B', 'C', 'A']);
    reorderMarkup(doc, ids[2]!, 'back');
    expect(doc.markups.map((m) => m.text?.subject)).toEqual(['C', 'B', 'A']);
    const back = await openDocument((await saveIncremental(doc)).bytes);
    expect(back.markups.map((m) => m.text?.subject)).toEqual(['C', 'B', 'A']);
    expect(back.pdfDoc.getPage(0).node.Annots()?.size()).toBe(3);
  });
});

describe('setMeasurementCaption', () => {
  it('turns the caption off and on, regenerating the appearance', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    const m = addLengthMeasurement(
      doc,
      0,
      { x: 200, y: 400 },
      { x: 1100, y: 400 },
      {
        subject: 'Wall',
        author: 'T',
      },
    );
    const withCaption = await renderPng((await saveIncremental(doc)).bytes, {
      scale: 0.25,
      annotations: true,
    });
    setMeasurementCaption(doc, m.id, false);
    expect(m.raw.lookup(PDFName.of('Cap'))?.toString()).toBe('false');
    expect(m.measure?.caption).toBe(false);
    const bytes = (await saveIncremental(doc)).bytes;
    const without = await renderPng(bytes, { scale: 0.25, annotations: true });
    expect(inkCoverage(without)).toBeLessThan(inkCoverage(withCaption));
    const back = await openDocument(bytes);
    expect(back.markups[0]!.measure?.caption).toBe(false);
    expect(back.markups[0]!.text?.contents).toBe(`100'-0"`); // /Contents keeps the value
    setMeasurementCaption(doc, m.id, true);
    expect(m.raw.lookup(PDFName.of('Cap'))?.toString()).toBe('true');
  });
});
