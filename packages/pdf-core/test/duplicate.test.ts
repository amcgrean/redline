/**
 * duplicateMarkup and setMarkupLocked.
 */

import { describe, expect, it } from 'vitest';
import { PDFName } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { setPageScale } from '../src/measure/viewport.js';
import { addLengthMeasurement } from '../src/annots/write.js';
import { duplicateMarkup, setMarkupLocked } from '../src/annots/duplicate.js';
import { lookupText } from '../src/annots/dict.js';
import { blankArchD, syntheticBluebeam } from './helpers/synthetic.js';
import { PDFDocument } from '@cantoo/pdf-lib';

const EIGHTH = { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const FTIN16 = { display: 'ft-in', precision: 16 } as const;
const NOW = new Date('2026-09-08T10:15:00-05:00');
const LATER = new Date('2026-09-08T11:00:00-05:00');
const AUTHOR = 'Aaron McGrane';

async function twoPages(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([2592, 1728]);
  doc.addPage([2592, 1728]);
  return doc.save({ useObjectStreams: false });
}

describe('duplicateMarkup', () => {
  it('copies a measurement with a new /NM, offset, same value', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    const m = addLengthMeasurement(
      doc,
      0,
      { x: 100, y: 100 },
      { x: 820, y: 100 },
      {
        subject: 'Wall',
        author: AUTHOR,
        now: NOW,
      },
    );
    const copy = duplicateMarkup(doc, m.id, { dx: 10, dy: -10, now: LATER });
    expect(copy.id).not.toBe(m.id);
    expect(copy.id).toMatch(/^[A-Z]{16}$/);
    expect(copy.text?.subject).toBe('Wall');
    expect(copy.text?.contents).toBe(`80'-0"`);
    expect(copy.geometry.kind === 'line' && copy.geometry.points[0]).toEqual({ x: 110, y: 90 });
    expect(lookupText(copy.raw, 'CreationDate')).not.toBe(lookupText(m.raw, 'CreationDate'));
    expect(doc.markups).toHaveLength(2);
    const { bytes } = await saveIncremental(doc);
    const back = await openDocument(bytes);
    expect(back.markups.map((x) => x.text?.contents)).toEqual([`80'-0"`, `80'-0"`]);
    expect(new Set(back.markups.map((x) => x.id)).size).toBe(2);
  });

  it('copies a Revu markup with its Bluebeam keys but not its reply/group links', async () => {
    const doc = await openDocument(await syntheticBluebeam());
    const parent = doc.markups.find((m) => m.intent === 'LineDimension')!;
    const child = doc.markups.find((m) => m.relations.groupParent)!;
    const copy = duplicateMarkup(doc, child.id, { dx: 5, dy: 5 });
    expect(copy.raw.has(PDFName.of('IRT'))).toBe(false);
    expect(copy.raw.has(PDFName.of('RT'))).toBe(false);
    expect(copy.relations.groupParent).toBeUndefined();
    expect(copy.raw.has(PDFName.of('BSIColumnData'))).toBe(
      child.raw.has(PDFName.of('BSIColumnData')),
    );
    const parentCopy = duplicateMarkup(doc, parent.id, { now: LATER });
    expect(lookupText(parentCopy.raw, 'RC')).toBe(lookupText(parent.raw, 'RC'));
    expect(parentCopy.raw.has(PDFName.of('Popup'))).toBe(false);
  });

  it('pastes onto another page with /P set and the target page scale applied', async () => {
    const doc = await openDocument(await twoPages());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    setPageScale(doc, 1, { ...EIGHTH, worldLength: 2 }, FTIN16);
    const m = addLengthMeasurement(
      doc,
      0,
      { x: 100, y: 100 },
      { x: 820, y: 100 },
      {
        subject: 'Wall',
        author: AUTHOR,
        now: NOW,
      },
    );
    const copy = duplicateMarkup(doc, m.id, { pageIndex: 1 });
    expect(copy.pageIndex).toBe(1);
    expect(copy.raw.get(PDFName.of('P'))).toBe(doc.pdfDoc.getPage(1).ref);
    // Page 2's scale is twice as large, so the same geometry reads twice the length.
    expect(copy.measure?.computed.length).toBeCloseTo(160, 6);
    const { bytes } = await saveIncremental(doc);
    const back = await openDocument(bytes);
    expect(back.markups.filter((x) => x.pageIndex === 1)).toHaveLength(1);
  });
});

describe('setMarkupLocked', () => {
  it('sets and clears bit 7 of /F, keeping Print', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    const m = addLengthMeasurement(
      doc,
      0,
      { x: 1, y: 1 },
      { x: 100, y: 1 },
      {
        subject: 'x',
        author: AUTHOR,
      },
    );
    setMarkupLocked(doc, m.id, true);
    expect(m.raw.lookup(PDFName.of('F'))?.toString()).toBe('132');
    expect(m.flags.locked).toBe(true);
    const back = (await openDocument((await saveIncremental(doc)).bytes)).markups[0]!;
    expect(back.flags.locked).toBe(true);
    expect(back.flags.print).toBe(true);
    setMarkupLocked(doc, m.id, false);
    expect(m.raw.lookup(PDFName.of('F'))?.toString()).toBe('4');
  });
});
