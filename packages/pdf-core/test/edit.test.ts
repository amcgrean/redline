/**
 * The inverse operations the editor's undo stack relies on: delete (undo of add) and
 * clearPageScale (undo of a first calibration). Each is checked on the live model AND
 * by saving incrementally and reopening, because the snapshot bookkeeping is where a
 * bug would hide.
 */

import { describe, expect, it } from 'vitest';
import { PDFArray, PDFName } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { addLengthMeasurement, addAreaMeasurement, moveMarkup } from '../src/annots/write.js';
import { deleteMarkup } from '../src/annots/delete.js';
import { setPageScale, clearPageScale } from '../src/measure/viewport.js';
import { blankArchD, syntheticBluebeam } from './helpers/synthetic.js';
import type { Scale, UnitFormat } from '../src/types.js';

const EIGHTH: Scale = { pageLength: 1, pageUnit: 'in', worldLength: 8, worldUnit: 'ft' };
const FTIN16: UnitFormat = { display: 'ft-in', precision: 16 };
const NOW = new Date('2026-09-08T10:15:00-05:00');
const opts = { subject: 'Test', author: 'Test', now: NOW };

async function reopen(doc: Awaited<ReturnType<typeof openDocument>>) {
  const { bytes, update } = await saveIncremental(doc);
  return { reopened: await openDocument(bytes), update: Buffer.from(update).toString('latin1') };
}

describe('deleteMarkup', () => {
  it('removes a markup Redline just added, so the update section never mentions it', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    const kept = addLengthMeasurement(doc, 0, { x: 100, y: 100 }, { x: 820, y: 100 }, opts);
    const gone = addLengthMeasurement(doc, 0, { x: 100, y: 300 }, { x: 820, y: 300 }, opts);

    const removed = deleteMarkup(doc, gone.id);
    expect(removed.id).toBe(gone.id);
    expect(doc.markups.map((m) => m.id)).toEqual([kept.id]);
    const annots = doc.pdfDoc.getPage(0).node.Annots();
    expect(annots instanceof PDFArray && annots.size()).toBe(1);

    const { reopened, update } = await reopen(doc);
    expect(reopened.markups.map((m) => m.id)).toEqual([kept.id]);
    expect(update).not.toContain(gone.id);
    expect(update).toContain(kept.id);
  });

  it('removes a markup that came from the file and leaves its neighbours byte-identical', async () => {
    const doc = await openDocument(await syntheticBluebeam());
    const before = doc.markups.map((m) => m.id);
    expect(before.length).toBeGreaterThan(2);
    const victim = doc.markups[1]!;
    const victimObj = victim.ref.objectNumber;

    deleteMarkup(doc, victim.id);
    const { reopened, update } = await reopen(doc);
    expect(reopened.markups.map((m) => m.id)).toEqual(before.filter((id) => id !== victim.id));
    // The freed object shows up in the xref as free, not as a rewritten dictionary.
    expect(update).not.toMatch(new RegExp(`\\n${victimObj} 0 obj`));
    // Only the /Annots holder was rewritten; no surviving annotation was.
    for (const m of reopened.markups) {
      expect(update).not.toContain(`/NM (${m.id})`);
    }
  });

  it('is the inverse of add: add, move, delete leaves no trace on reopen', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    const area = addAreaMeasurement(
      doc,
      0,
      [
        { x: 100, y: 100 },
        { x: 400, y: 100 },
        { x: 400, y: 300 },
        { x: 100, y: 300 },
      ],
      opts,
    );
    moveMarkup(doc, area.id, 10, 10, NOW);
    deleteMarkup(doc, area.id);
    const { reopened } = await reopen(doc);
    expect(reopened.markups).toHaveLength(0);
  });
});

describe('clearPageScale', () => {
  it('removes only the viewport Redline wrote and restores the document scale', async () => {
    const doc = await openDocument(await syntheticBluebeam());
    const documentScale = doc.pageScales.get(0);
    expect(documentScale?.fromDocument).toBe(true);
    const vpBefore = doc.pdfDoc.getPage(0).node.lookup(PDFName.of('VP'));
    const countBefore = vpBefore instanceof PDFArray ? vpBefore.size() : 0;

    setPageScale(doc, 0, EIGHTH, FTIN16);
    expect(doc.pageScales.get(0)?.fromDocument).toBe(false);

    expect(clearPageScale(doc, 0)).toBe(true);
    expect(doc.pageScales.get(0)).toEqual(documentScale);
    const vpAfter = doc.pdfDoc.getPage(0).node.lookup(PDFName.of('VP'));
    expect(vpAfter instanceof PDFArray ? vpAfter.size() : 0).toBe(countBefore);

    const { reopened } = await reopen(doc);
    expect(reopened.pageScales.get(0)).toEqual(documentScale);
    expect(clearPageScale(reopened, 0)).toBe(false);
  });

  it('drops the /VP key entirely when Redline created it on a page that had none', async () => {
    const doc = await openDocument(await blankArchD());
    expect(doc.pageScales.has(0)).toBe(false);
    setPageScale(doc, 0, EIGHTH, FTIN16);
    clearPageScale(doc, 0);
    expect(doc.pdfDoc.getPage(0).node.has(PDFName.of('VP'))).toBe(false);
    expect(doc.pageScales.has(0)).toBe(false);

    const { reopened } = await reopen(doc);
    expect(reopened.pageScales.has(0)).toBe(false);
    expect(reopened.pdfDoc.getPage(0).node.has(PDFName.of('VP'))).toBe(false);
  });

  it('re-calibrating after a clear works and yields exactly one Redline viewport', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    clearPageScale(doc, 0);
    setPageScale(doc, 0, { ...EIGHTH, worldLength: 4 }, FTIN16);
    const { reopened } = await reopen(doc);
    const vp = reopened.pdfDoc.getPage(0).node.lookup(PDFName.of('VP'));
    expect(vp instanceof PDFArray ? vp.size() : 0).toBe(1);
    expect(reopened.pageScales.get(0)?.scale.worldLength).toBeCloseTo(4, 5);
  });
});
