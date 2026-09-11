/**
 * Bookmarks through page operations, and split.
 */

import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { readOutlines, writeOutlines, type OutlineItem } from '../src/pages/outlines.js';
import {
  deletePages,
  insertPagesFrom,
  mergeDocuments,
  movePages,
  saveFull,
} from '../src/pages/ops.js';
import { everyN, parseRanges, splitDocument } from '../src/pages/split.js';
import { addNote } from '../src/annots/text.js';

async function withBookmarks(prefix: string, sizes: number[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  for (const w of sizes) pdf.addPage([w, 500]);
  const items: OutlineItem[] = sizes.map((_, i) => ({
    title: `${prefix} ${i + 1}`,
    pageIndex: i,
    children: i === 0 ? [{ title: `${prefix} detail`, pageIndex: 0, children: [] }] : [],
  }));
  writeOutlines(pdf, items);
  return pdf.save({ useObjectStreams: false });
}

const titles = (items: OutlineItem[]): string[] =>
  items.flatMap((i) => [`${i.title}@${i.pageIndex ?? '-'}`, ...titles(i.children)]);

describe('outlines', () => {
  it('write then read round-trips titles, pages, nesting and unicode', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.addPage([100, 100]);
    pdf.addPage([100, 100]);
    writeOutlines(pdf, [
      { title: 'Plans — élévation', pageIndex: 0, children: [], closed: false },
      {
        title: 'Details',
        pageIndex: 1,
        closed: true,
        children: [{ title: 'D1', pageIndex: 1, children: [] }],
      },
      { title: 'No page', children: [] },
    ]);
    const back = await PDFDocument.load(await pdf.save({ useObjectStreams: false }));
    const items = readOutlines(back);
    expect(titles(items)).toEqual(['Plans — élévation@0', 'Details@1', 'D1@1', 'No page@-']);
    expect(items[1]?.closed).toBe(true);
  });

  it('survive rotate/move, are pruned by delete, and merge/insert carry the source bookmarks', async () => {
    const a = await withBookmarks('A', [1000, 2000, 3000]);
    const b = await withBookmarks('B', [4000, 5000]);

    let doc = await openDocument(a);
    movePages(doc, [2], 0);
    let back = await openDocument(await saveFull(doc));
    expect(titles(readOutlines(back.pdfDoc))).toEqual(['A 1@1', 'A detail@1', 'A 2@2', 'A 3@0']);

    doc = await openDocument(a);
    deletePages(doc, [0]);
    back = await openDocument(await saveFull(doc));
    expect(titles(readOutlines(back.pdfDoc))).toEqual(['A 2@0', 'A 3@1']);

    const merged = await openDocument(await mergeDocuments([a, b]));
    expect(titles(readOutlines(merged.pdfDoc))).toEqual([
      'A 1@0',
      'A detail@0',
      'A 2@1',
      'A 3@2',
      'B 1@3',
      'B detail@3',
      'B 2@4',
    ]);

    doc = await openDocument(a);
    await insertPagesFrom(doc, b, 1, [1]);
    back = await openDocument(await saveFull(doc));
    // B's second page landed at index 1; B's first-page bookmarks had no copied page.
    expect(titles(readOutlines(back.pdfDoc))).toEqual([
      'A 1@0',
      'A detail@0',
      'A 2@2',
      'A 3@3',
      'B 2@1',
    ]);
  });
});

describe('split', () => {
  it('parses ranges and every-N', () => {
    expect(parseRanges('1-2, 4, 6-', 7)).toEqual([[0, 1], [3], [5, 6]]);
    expect(() => parseRanges('0-2', 7)).toThrow(/outside/);
    expect(() => parseRanges('x', 7)).toThrow(/Cannot read/);
    expect(everyN(7, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(() => everyN(7, 0)).toThrow();
  });

  it('splits into parts that keep their markups', async () => {
    const doc = await openDocument(await withBookmarks('S', [1000, 2000, 3000, 4000]));
    for (const i of [0, 1, 2, 3]) {
      addNote(doc, i, { x: 5, y: 50 }, { author: 'T', subject: 'Note', text: `p${i + 1}` });
    }
    const parts = await splitDocument(doc, everyN(4, 3));
    expect(parts.map((p) => [p.from, p.to])).toEqual([
      [1, 3],
      [4, 4],
    ]);
    const first = await openDocument(parts[0]!.bytes);
    expect(first.pageSizes.map((s) => s.width)).toEqual([1000, 2000, 3000]);
    expect(first.markups.map((m) => m.text?.contents)).toEqual(['p1', 'p2', 'p3']);
    const second = await openDocument(parts[1]!.bytes);
    expect(second.markups.map((m) => m.text?.contents)).toEqual(['p4']);
  });
});
