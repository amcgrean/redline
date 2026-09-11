/**
 * Page operations + full save: rotate, delete, move, insert, extract, merge. Every case
 * re-opens the saved bytes and checks the page order and the markups that rode along.
 */

import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { setPageScale } from '../src/measure/viewport.js';
import { addLengthMeasurement } from '../src/annots/write.js';
import { addNote } from '../src/annots/text.js';
import { deleteMarkup } from '../src/annots/delete.js';
import {
  deletePages,
  extractPages,
  insertBlankPage,
  insertPagesFrom,
  mergeDocuments,
  movePages,
  rotatePages,
  saveFull,
} from '../src/pages/ops.js';
import { syntheticBluebeam } from './helpers/synthetic.js';

const EIGHTH = { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const FTIN16 = { display: 'ft-in', precision: 16 } as const;

/** Three pages of different widths, a note on each saying which page it is. */
async function threePages(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.addPage([1000, 500]);
  pdf.addPage([2000, 500]);
  pdf.addPage([3000, 500]);
  const bytes = await pdf.save({ useObjectStreams: false });
  const doc = await openDocument(bytes);
  for (const i of [0, 1, 2]) {
    addNote(doc, i, { x: 10, y: 10 }, { author: 'T', subject: 'Note', text: `page ${i + 1}` });
  }
  return (await saveIncremental(doc)).bytes;
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await openDocument(bytes);
  return doc.pageSizes.map((s) => s.width);
}

async function noteTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await openDocument(bytes);
  return doc.markups
    .sort((a, b) => a.pageIndex - b.pageIndex)
    .map((m) => `${m.pageIndex + 1}:${m.text?.contents}`);
}

describe('page operations', () => {
  it('rotates pages and keeps their markups', async () => {
    const doc = await openDocument(await threePages());
    rotatePages(doc, [0, 2], 90);
    rotatePages(doc, [2], 90);
    const back = await openDocument(await saveFull(doc));
    expect(back.pageSizes.map((s) => s.rotation)).toEqual([90, 0, 180]);
    expect(await noteTexts(await saveFull(doc))).toEqual(['1:page 1', '2:page 2', '3:page 3']);
  });

  it('deletes pages; their markups go with them; the last page cannot go', async () => {
    const doc = await openDocument(await threePages());
    expect(deletePages(doc, [1])).toBe(1);
    const bytes = await saveFull(doc);
    expect(await widths(bytes)).toEqual([1000, 3000]);
    expect(await noteTexts(bytes)).toEqual(['1:page 1', '2:page 3']);
    const two = await openDocument(bytes);
    expect(() => deletePages(two, [0, 1])).toThrow(/at least one page/);
  });

  it('moves pages to the front, to the end, and a block into the middle', async () => {
    let doc = await openDocument(await threePages());
    movePages(doc, [2], 0);
    let bytes = await saveFull(doc);
    expect(await widths(bytes)).toEqual([3000, 1000, 2000]);
    expect(await noteTexts(bytes)).toEqual(['1:page 3', '2:page 1', '3:page 2']);

    doc = await openDocument(bytes);
    movePages(doc, [0], 3);
    bytes = await saveFull(doc);
    expect(await widths(bytes)).toEqual([1000, 2000, 3000]);

    doc = await openDocument(bytes);
    movePages(doc, [0, 1], 3);
    bytes = await saveFull(doc);
    expect(await widths(bytes)).toEqual([3000, 1000, 2000]);
  });

  it('inserts a blank page and pages from another file', async () => {
    const doc = await openDocument(await threePages());
    insertBlankPage(doc, 1, [500, 500]);
    const other = await PDFDocument.create({ updateMetadata: false });
    other.addPage([4000, 500]);
    other.addPage([5000, 500]);
    const added = await insertPagesFrom(doc, await other.save(), 0, [1]);
    expect(added).toBe(1);
    const bytes = await saveFull(doc);
    expect(await widths(bytes)).toEqual([5000, 1000, 500, 2000, 3000]);
    expect(await noteTexts(bytes)).toEqual(['2:page 1', '4:page 2', '5:page 3']);
  });

  it('extracts and merges, carrying markups', async () => {
    const source = await threePages();
    const doc = await openDocument(source);
    const extracted = await extractPages(doc, [2, 0]);
    expect(await widths(extracted)).toEqual([3000, 1000]);
    expect(await noteTexts(extracted)).toEqual(['1:page 3', '2:page 1']);

    const merged = await mergeDocuments([extracted, source]);
    expect(await widths(merged)).toEqual([3000, 1000, 1000, 2000, 3000]);
    expect((await openDocument(merged)).markups).toHaveLength(5);
  });

  it('full save keeps Bluebeam keys and applies pending deletions', async () => {
    const doc = await openDocument(await syntheticBluebeam());
    const before = doc.markups.map((m) => [
      m.id,
      [...m.raw.keys()].map((k) => k.asString()).sort(),
    ]);
    const victim = doc.markups.find((m) => m.rawSubtype === 'Square') ?? doc.markups[0]!;
    deleteMarkup(doc, victim.id);
    rotatePages(doc, [0], 180);
    const back = await openDocument(await saveFull(doc));
    expect(back.markups.map((m) => m.id)).not.toContain(victim.id);
    for (const [id, keys] of before) {
      if (id === victim.id) continue;
      const m = back.markups.find((x) => x.id === id);
      expect(m, `markup ${id} survived`).toBeDefined();
      expect([...m!.raw.keys()].map((k) => k.asString()).sort()).toEqual(keys);
    }
    // The Bluebeam page-level extras survive too.
    const page = back.pdfDoc.getPage(0);
    expect(page.node.has(PDFName.of('BSISpaces'))).toBe(
      doc.pdfDoc.getPage(0).node.has(PDFName.of('BSISpaces')),
    );
    expect(back.pageSizes[0]?.rotation).toBe(180);
  });

  it('a measurement on a rotated page still reads the same length after reopen', async () => {
    const doc = await openDocument(await threePages());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    addLengthMeasurement(
      doc,
      0,
      { x: 100, y: 100 },
      { x: 820, y: 100 },
      {
        subject: 'Wall',
        author: 'T',
      },
    );
    rotatePages(doc, [0], 90);
    const back = await openDocument(await saveFull(doc));
    const wall = back.markups.find((m) => m.text?.subject === 'Wall')!;
    expect(wall.measure?.computed.length).toBeCloseTo(80, 4); // /C carries 7 significant digits
    const scale = back.pageScales.get(0)!.scale;
    expect(scale.worldLength / scale.pageLength).toBeCloseTo(8, 5);
  });
});
