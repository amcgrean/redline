/**
 * Corpus round-trip. For every PDF in `fixtures/`: open, move one markup by 10 pt, save
 * incrementally, reopen, and assert that
 *   - only owned keys changed on the moved annotation and nothing changed on any other,
 *   - `/BSIColumnData`, `/BSISpaces`, `/BSIAnnotColumns`, `/RC`, `/IRT`, `/OC` and every
 *     pre-existing `/VP` entry serialise identically before and after,
 *   - pdf.js opens the output with the same page count.
 *
 * Fixtures are read-only (CLAUDE.md #8); outputs go to `fixtures/out/corpus/`.
 * The synthetic Bluebeam file is included so the BSI* / IRT / OC assertions run even
 * while the real corpus lacks those keys.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PDFDict } from '@cantoo/pdf-lib';
import { PDFArray, PDFName, PDFRef, type PDFContext } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { moveMarkup } from '../src/annots/write.js';
import { MUST_NOT_CHANGE_KEYS, OWNED_KEYS } from '../src/annots/ownership.js';
import type { Markup, RedlineDocument } from '../src/types.js';
import { changedKeys, keyMap, serialize } from './helpers/serialize.js';
import { loadWithPdfjs } from './helpers/render.js';
import { syntheticBluebeam } from './helpers/synthetic.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = resolve(HERE, '../../../fixtures');
const OUT = join(FIXTURES, 'out', 'corpus');

const SERIALIZE = { depth: 5, streams: false } as const;

interface Snapshot {
  annots: Map<string, Map<string, string>>;
  catalogColumns: string;
  pageSpaces: string[];
  pageViewports: string[][];
}

function annotKey(markup: Markup): string {
  return `${markup.ref.objectNumber}:${markup.ref.generationNumber}`;
}

function viewportEntries(page: PDFDict, ctx: PDFContext): string[] {
  const vp = page.lookup(PDFName.of('VP'));
  if (!(vp instanceof PDFArray)) return [];
  const out: string[] = [];
  for (let i = 0; i < vp.size(); i += 1) out.push(serialize(vp.get(i), ctx, { depth: 6 }));
  return out;
}

function snapshot(doc: RedlineDocument): Snapshot {
  const ctx = doc.pdfDoc.context;
  const annots = new Map<string, Map<string, string>>();
  for (const m of doc.markups) annots.set(annotKey(m), keyMap(m.raw, ctx, SERIALIZE));
  const pages = doc.pdfDoc.getPages();
  return {
    annots,
    catalogColumns: serialize(doc.pdfDoc.catalog.get(PDFName.of('BSIAnnotColumns')), ctx, {
      depth: 6,
    }),
    pageSpaces: pages.map((p) => serialize(p.node.get(PDFName.of('BSISpaces')), ctx, { depth: 8 })),
    pageViewports: pages.map((p) => viewportEntries(p.node, ctx)),
  };
}

/** The first markup with geometry Redline can translate. */
function pickMovable(doc: RedlineDocument): Markup | undefined {
  return (
    doc.markups.find((m) => m.geometry.kind === 'line' || m.geometry.kind === 'poly') ??
    doc.markups.find((m) => m.geometry.kind !== 'none') ??
    doc.markups[0]
  );
}

interface Case {
  name: string;
  load: () => Promise<Uint8Array>;
  synthetic: boolean;
}

const cases: Case[] = [
  { name: 'synthetic-bluebeam.pdf', load: syntheticBluebeam, synthetic: true },
  ...listPdfs(FIXTURES, ''),
  // Files Revu saved after editing a Redline output (interop checklist R7).
  ...listPdfs(join(FIXTURES, 'from-revu'), 'from-revu/'),
];

function listPdfs(dir: string, prefix: string): Case[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => ({
      name: `${prefix}${f}`,
      load: async () => new Uint8Array(readFileSync(join(dir, f))),
      synthetic: false,
    }));
}

describe.each(cases)('corpus round-trip: $name', ({ name, load, synthetic }) => {
  it('moves one markup by 10 pt and changes only owned keys', async () => {
    const original = await load();
    const doc = await openDocument(original);
    const before = snapshot(doc);
    const target = pickMovable(doc);

    if (!target) {
      // A fixture with no annotations still has to survive open -> save -> reopen.
      const { bytes } = await saveIncremental(doc);
      const reopened = await openDocument(bytes);
      expect(reopened.markups).toHaveLength(0);
      expect(snapshot(reopened).pageViewports).toEqual(before.pageViewports);
      return;
    }

    const hadNM = target.raw.has(PDFName.of('NM'));
    const beforeMoved = before.annots.get(annotKey(target))!;
    moveMarkup(doc, target.id, 10, 10);

    const { bytes, update } = await saveIncremental(doc);
    expect(bytes.length).toBe(original.length + update.length);
    expect(Buffer.from(bytes.subarray(0, original.length)).equals(Buffer.from(original))).toBe(
      true,
    );

    if (!synthetic) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${basename(name.replace(/\//g, '_'), '.pdf')}.moved.pdf`), bytes);
    }

    const reopened = await openDocument(bytes);
    const after = snapshot(reopened);

    expect(reopened.markups.length).toBe(doc.markups.length);
    expect(after.catalogColumns).toBe(before.catalogColumns);
    expect(after.pageSpaces).toEqual(before.pageSpaces);
    expect(after.pageViewports).toEqual(before.pageViewports);

    for (const [key, beforeKeys] of before.annots) {
      const afterKeys = after.annots.get(key);
      expect(afterKeys, `annotation ${key} disappeared`).toBeDefined();
      const changed = changedKeys(beforeKeys, afterKeys!);
      if (key === annotKey(target)) {
        const allowed = new Set<string>([...OWNED_KEYS, ...(hadNM ? [] : ['NM'])]);
        for (const k of changed)
          expect(allowed, `unowned key /${k} changed on moved markup`).toContain(k);
        expect(changed).toContain('Rect');
        expect(changed).toContain('M');
        for (const k of MUST_NOT_CHANGE_KEYS) {
          if (k === 'NM' && !hadNM) continue;
          expect(afterKeys!.get(k), `/${k} must be byte-identical`).toBe(beforeMoved.get(k));
        }
      } else {
        expect(changed, `untouched annotation ${key} changed keys`).toEqual([]);
      }
    }

    const geometryKey =
      target.geometry.kind === 'line' ? 'L' : target.geometry.kind === 'poly' ? 'Vertices' : 'Rect';
    const afterMoved = after.annots.get(annotKey(target))!;
    expect(afterMoved.get(geometryKey)).not.toBe(beforeMoved.get(geometryKey));

    const pdfjs = await loadWithPdfjs(bytes);
    try {
      expect(pdfjs.doc.numPages).toBe(doc.pdfDoc.getPageCount());
      const page = await pdfjs.doc.getPage(target.pageIndex + 1);
      const annots = await page.getAnnotations();
      expect(annots.length).toBeGreaterThan(0);
    } finally {
      await pdfjs.destroy();
    }

    // The moved annotation's ref did not change, so its /IRT/reply chain still resolves.
    const movedAgain = reopened.markups.find((m) => annotKey(m) === annotKey(target));
    expect(movedAgain).toBeDefined();
    expect(movedAgain!.ref instanceof PDFRef).toBe(true);
  });
});
