/**
 * updateMarkupProperties: subject and style edits rewrite only owned keys.
 */

import { describe, expect, it } from 'vitest';
import { PDFName } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { setPageScale } from '../src/measure/viewport.js';
import {
  addCountMarkup,
  addLengthMeasurement,
  canRegenerateAppearance,
  updateMarkupProperties,
} from '../src/annots/write.js';
import { lookupText } from '../src/annots/dict.js';
import { blankArchD, syntheticBluebeam } from './helpers/synthetic.js';
import { changedKeys, keyMap } from './helpers/serialize.js';

const EIGHTH = { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const FTIN16 = { display: 'ft-in', precision: 16 } as const;
const NOW = new Date('2026-09-08T10:15:00-05:00');
const LATER = new Date('2026-09-08T11:00:00-05:00');
const AUTHOR = 'Aaron McGrane';

describe('updateMarkupProperties', () => {
  it('renames and restyles a length: Subj, C, BS, CA, AP, M only', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    const m = addLengthMeasurement(
      doc,
      0,
      { x: 100, y: 100 },
      { x: 820, y: 100 },
      {
        subject: 'Length',
        author: AUTHOR,
        now: NOW,
      },
    );
    const before = keyMap(m.raw, doc.pdfDoc.context);
    updateMarkupProperties(
      doc,
      m.id,
      { subject: 'Ext Wall 2x6', stroke: { r: 0, g: 0.4, b: 0.8 }, width: 3, opacity: 0.7 },
      LATER,
    );
    const after = keyMap(m.raw, doc.pdfDoc.context);
    // /Rect grows with the thicker arrowheads; everything else is the edited key set.
    expect(changedKeys(before, after).sort()).toEqual(['AP', 'BS', 'C', 'CA', 'M', 'Rect', 'Subj']);
    expect(m.text?.subject).toBe('Ext Wall 2x6');
    expect(m.style.width).toBe(3);
    // The value is untouched: a restyle never changes what was measured.
    expect(lookupText(m.raw, 'Contents')).toBe(`80'-0"`);

    const { bytes } = await saveIncremental(doc);
    const back = (await openDocument(bytes)).markups[0]!;
    expect(back.text?.subject).toBe('Ext Wall 2x6');
    expect(back.style.stroke).toEqual({ r: 0, g: 0.4, b: 0.8 });
    expect(back.style.opacity).toBe(0.7);
  });

  it('keeps a foreign appearance stream and every Bluebeam key when only Subj changes', async () => {
    const doc = await openDocument(await syntheticBluebeam());
    const stamp = doc.markups.find((m) => !canRegenerateAppearance(m));
    expect(stamp).toBeDefined();
    const before = keyMap(stamp!.raw, doc.pdfDoc.context);
    updateMarkupProperties(doc, stamp!.id, { subject: 'Renamed' }, LATER);
    const after = keyMap(stamp!.raw, doc.pdfDoc.context);
    expect(changedKeys(before, after).sort()).toEqual(['M', 'Subj']);
    // /RC mirrors /Contents, not /Subj, so it is untouched.
    expect(after.get('RC')).toBe(before.get('RC'));
  });

  it('restyles a count symbol by redrawing its disc in the new colour', async () => {
    const doc = await openDocument(await blankArchD());
    const m = addCountMarkup(
      doc,
      0,
      { x: 500, y: 600 },
      {
        subject: 'Studs',
        author: AUTHOR,
        group: 'G',
        now: NOW,
      },
    );
    const apBefore = m.raw.get(PDFName.of('AP'))?.toString();
    updateMarkupProperties(doc, m.id, { stroke: { r: 0, g: 0, b: 1 }, fill: { r: 0, g: 0, b: 1 } });
    expect(m.raw.get(PDFName.of('AP'))?.toString()).not.toBe(apBefore);
    expect(m.rect).toEqual([493, 593, 507, 607]);
    expect(m.style.fill).toEqual({ r: 0, g: 0, b: 1 });
  });

  it('fill: null removes /IC', async () => {
    const doc = await openDocument(await blankArchD());
    const m = addCountMarkup(doc, 0, { x: 1, y: 1 }, { subject: 'x', author: AUTHOR, group: 'G' });
    expect(m.raw.has(PDFName.of('IC'))).toBe(true);
    updateMarkupProperties(doc, m.id, { fill: null });
    expect(m.raw.has(PDFName.of('IC'))).toBe(false);
    expect(m.style.fill).toBeUndefined();
  });
});
