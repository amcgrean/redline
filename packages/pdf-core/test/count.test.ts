/**
 * Count symbols: standard `/Circle` markups + `/RLTool (count)` + `/RLAttrs`.
 * PLAN §7 mitigation: no Bluebeam-private count intent until Revu's form is verified.
 */

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { addCountMarkup, countGroupOf, moveMarkup } from '../src/annots/write.js';
import { deleteMarkup } from '../src/annots/delete.js';
import { lookupText } from '../src/annots/dict.js';
import { blankArchD } from './helpers/synthetic.js';
import { changedKeys, keyMap, serializeDict } from './helpers/serialize.js';
import { expectPngSnapshot, inkCoverage, renderPng } from './helpers/render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = join(HERE, '__snapshots__');
const NOW = new Date('2026-09-08T10:15:00-05:00');
const AUTHOR = 'Aaron McGrane';
const SNAPSHOT_OPTIONS = { depth: 4, streams: true } as const;

describe('addCountMarkup', () => {
  it('writes a /Circle with /AP, /RLTool and /RLAttrs, no /Measure (snapshot)', async () => {
    const doc = await openDocument(await blankArchD());
    const markup = addCountMarkup(
      doc,
      0,
      { x: 500, y: 600 },
      { subject: 'Studs', author: AUTHOR, group: 'COUNTGROUPABCDEF', now: NOW, nm: 'COUNTONEABCDEFGH' },
    );
    expect(markup.subtype).toBe('Circle');
    expect(markup.rect).toEqual([493, 593, 507, 607]);
    expect(markup.attrs).toEqual({ count: 1, group: 'COUNTGROUPABCDEF' });
    expect(countGroupOf(markup)).toBe('COUNTGROUPABCDEF');
    expect(lookupText(markup.raw, 'RLTool')).toBe('count');
    expect(markup.raw.has(markup.raw.context.obj('Measure') as never)).toBe(false);
    await expect(
      serializeDict(markup.raw, doc.pdfDoc.context, SNAPSHOT_OPTIONS),
    ).toMatchFileSnapshot('./__snapshots__/count-symbol.txt');
  });

  it('a set of symbols shares its group across save and reopen; deleting one leaves the rest', async () => {
    const doc = await openDocument(await blankArchD());
    const group = 'COUNTGROUPABCDEF';
    const points = [
      { x: 300, y: 300 },
      { x: 400, y: 300 },
      { x: 500, y: 300 },
    ];
    const symbols = points.map((p) =>
      addCountMarkup(doc, 0, p, { subject: 'Studs', author: AUTHOR, group, now: NOW }),
    );
    deleteMarkup(doc, symbols[1]!.id);
    const { bytes } = await saveIncremental(doc);
    const reopened = await openDocument(bytes);
    const counted = reopened.markups.filter((m) => countGroupOf(m) === group);
    expect(counted).toHaveLength(2);
    expect(counted.every((m) => m.subtype === 'Circle' && m.text?.subject === 'Studs')).toBe(true);
    expect(counted.map((m) => m.attrs)).toEqual([
      { count: 1, group },
      { count: 1, group },
    ]);
  });

  it('moves by translating /Rect only (the /AP maps onto the new /Rect)', async () => {
    const doc = await openDocument(await blankArchD());
    const markup = addCountMarkup(
      doc,
      0,
      { x: 500, y: 600 },
      { subject: 'Studs', author: AUTHOR, group: 'G', now: NOW },
    );
    const before = keyMap(markup.raw, doc.pdfDoc.context);
    moveMarkup(doc, markup.id, 20, -10, new Date('2026-09-08T11:00:00-05:00'));
    const after = keyMap(markup.raw, doc.pdfDoc.context);
    expect(changedKeys(before, after).sort()).toEqual(['M', 'Rect']);
    expect(markup.rect).toEqual([513, 583, 527, 597]);
  });

  it('is not a count when /RLTool says otherwise', async () => {
    const doc = await openDocument(await blankArchD());
    const markup = addCountMarkup(
      doc,
      0,
      { x: 1, y: 1 },
      { subject: 'x', author: AUTHOR, group: 'G', now: NOW },
    );
    markup.raw.set(markup.raw.context.obj('RLTool') as never, markup.raw.context.obj('length') as never);
    expect(countGroupOf(markup)).toBeUndefined();
  });
});

describe('count symbols render in pdf.js', () => {
  it('draws filled discs where the clicks were', async () => {
    const doc = await openDocument(await blankArchD());
    for (const [i, p] of [
      { x: 400, y: 1200 },
      { x: 700, y: 1100 },
      { x: 1000, y: 1000 },
      { x: 1300, y: 900 },
    ].entries()) {
      addCountMarkup(doc, 0, p, {
        subject: 'Studs',
        author: AUTHOR,
        group: 'G',
        now: NOW,
        style: { radius: 6 + i * 4 },
      });
    }
    const { bytes } = await saveIncremental(doc);
    const withAnnots = await renderPng(bytes, { scale: 0.25, annotations: true });
    const without = await renderPng(bytes, { scale: 0.25, annotations: false });
    expect(inkCoverage(withAnnots)).toBeGreaterThan(inkCoverage(without) + 50);
    expectPngSnapshot(withAnnots, join(SNAPSHOTS, 'ap-count.png'));
  });
});
