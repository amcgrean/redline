import { describe, expect, it } from 'vitest';
import { PDFDict, PDFName, PDFArray } from '@cantoo/pdf-lib';
import { openDocument, requireMarkup } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { setPageScale } from '../src/measure/viewport.js';
import { addAreaMeasurement, addLengthMeasurement, moveMarkup } from '../src/annots/write.js';
import { OWNED_KEYS } from '../src/annots/ownership.js';
import { lookupText } from '../src/annots/dict.js';
import { blankArchD, syntheticBluebeam } from './helpers/synthetic.js';
import { changedKeys, keyMap, serializeDict } from './helpers/serialize.js';
import { loadWithPdfjs } from './helpers/render.js';

const EIGHTH_INCH = { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const FT_IN_16 = { display: 'ft-in', precision: 16 } as const;
const NOW = new Date('2026-09-08T10:15:00-05:00');
const AUTHOR = 'Aaron McGrean';

const SNAPSHOT_OPTIONS = { depth: 4, streams: true } as const;

async function calibratedBlank() {
  const doc = await openDocument(await blankArchD());
  setPageScale(doc, 0, EIGHTH_INCH, FT_IN_16);
  return doc;
}

describe('addLengthMeasurement', () => {
  it('writes the dictionary from PLAN Appendix A (snapshot)', async () => {
    const doc = await calibratedBlank();
    const markup = addLengthMeasurement(
      doc,
      0,
      { x: 100, y: 100 },
      { x: 820, y: 100 },
      { subject: 'Ext Wall 2x6', author: AUTHOR, now: NOW, nm: 'KQWVXHPTMBZRCJAL' },
    );
    // 720 pt at 1/8" = 1' is 80'-0" — the plan's own worked example.
    expect(markup.text?.contents).toBe(`80'-0"`);
    expect(markup.measure?.computed.length).toBeCloseTo(80, 6);
    await expect(
      serializeDict(markup.raw, doc.pdfDoc.context, SNAPSHOT_OPTIONS),
    ).toMatchFileSnapshot('./__snapshots__/length-80ft.txt');
  });

  it('carries every key the kickoff demands', async () => {
    const doc = await calibratedBlank();
    const markup = addLengthMeasurement(
      doc,
      0,
      { x: 300, y: 400 },
      { x: 300, y: 1000 },
      { subject: 'Wall', author: AUTHOR, now: NOW },
    );
    const keys = new Set([...markup.raw.keys()].map((k) => k.asString().slice(1)));
    for (const key of [
      'Type',
      'Subtype',
      'IT',
      'L',
      'Rect',
      'Measure',
      'Contents',
      'Cap',
      'NM',
      'T',
      'M',
      'CreationDate',
      'Subj',
      'F',
      'C',
      'CA',
      'BS',
      'LE',
      'LL',
      'LLE',
      'AP',
      'P',
    ]) {
      expect(keys, `missing /${key}`).toContain(key);
    }
    expect(lookupText(markup.raw, 'NM')).toMatch(/^[A-Z]{16}$/);
    // 600 pt at 1/8" = 1' (9 pt per foot) is 66.67 ft.
    expect(lookupText(markup.raw, 'Contents')).toBe(`66'-8"`);
    const measure = markup.raw.lookup(PDFName.of('Measure'));
    expect(measure).toBeInstanceOf(PDFDict);
    for (const key of ['R', 'X', 'D', 'A', 'T']) {
      expect((measure as PDFDict).has(PDFName.of(key)), `Measure lacks /${key}`).toBe(true);
    }
    // /Rect contains the line plus leaders and caption.
    const [x0, y0, x1, y1] = markup.rect;
    expect(x0).toBeLessThan(300);
    expect(x1).toBeGreaterThan(300);
    expect(y0).toBeLessThan(400);
    expect(y1).toBeGreaterThan(1000);
  });

  it('refuses to write on an uncalibrated page', async () => {
    const doc = await openDocument(await blankArchD());
    expect(() =>
      addLengthMeasurement(doc, 0, { x: 0, y: 0 }, { x: 10, y: 0 }, { subject: 'x', author: 'y' }),
    ).toThrow(/no scale/);
  });
});

describe('addAreaMeasurement', () => {
  it('writes the dictionary for a 30 x 20 ft room (snapshot)', async () => {
    const doc = await calibratedBlank();
    // 1/8" = 1' => 9 pt per foot. 30 x 20 ft = 270 x 180 pt.
    const markup = addAreaMeasurement(
      doc,
      0,
      [
        { x: 500, y: 500 },
        { x: 770, y: 500 },
        { x: 770, y: 680 },
        { x: 500, y: 680 },
      ],
      { subject: 'Tile', author: AUTHOR, now: NOW, nm: 'AREAAREAAREAAREA' },
    );
    expect(markup.text?.contents).toBe('600 sf');
    expect(markup.measure?.computed.area).toBeCloseTo(600, 6);
    expect(markup.measure?.computed.perimeter).toBeCloseTo(100, 6);
    await expect(
      serializeDict(markup.raw, doc.pdfDoc.context, SNAPSHOT_OPTIONS),
    ).toMatchFileSnapshot('./__snapshots__/area-600sf.txt');
  });

  it('rejects fewer than three vertices', async () => {
    const doc = await calibratedBlank();
    expect(() =>
      addAreaMeasurement(
        doc,
        0,
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        { subject: 'x', author: 'y' },
      ),
    ).toThrow(/three/);
  });
});

describe('moveMarkup', () => {
  it('translates geometry, /Rect and /AP, bumps /M, and touches nothing else', async () => {
    const doc = await calibratedBlank();
    const created = addLengthMeasurement(
      doc,
      0,
      { x: 100, y: 100 },
      { x: 820, y: 100 },
      { subject: 'Wall', author: AUTHOR, now: NOW },
    );
    const before = keyMap(created.raw, doc.pdfDoc.context, SNAPSHOT_OPTIONS);
    const later = new Date('2026-09-08T11:00:00-05:00');
    const moved = moveMarkup(doc, created.id, 10, 10, later);

    const after = keyMap(moved.raw, doc.pdfDoc.context, SNAPSHOT_OPTIONS);
    const changed = changedKeys(before, after);
    expect(changed).toEqual(['AP', 'L', 'M', 'Rect']);
    for (const key of changed) expect(OWNED_KEYS).toContain(key);

    expect(moved.geometry).toEqual({
      kind: 'line',
      points: [
        { x: 110, y: 110 },
        { x: 830, y: 110 },
      ],
    });
    expect(lookupText(moved.raw, 'NM')).toBe(created.id);
    expect(lookupText(moved.raw, 'Contents')).toBe(`80'-0"`);
  });

  it('moves a Revu-style markup while keeping /RC, /BSIColumnData, /IRT and /OC intact', async () => {
    const doc = await openDocument(await syntheticBluebeam());
    const ctx = doc.pdfDoc.context;
    const parent = requireMarkup(doc, 'PARENTGROUPLINEA');
    const child = requireMarkup(doc, 'CHILDOFGROUPBBBB');
    const beforeParent = keyMap(parent.raw, ctx, SNAPSHOT_OPTIONS);
    const beforeChild = keyMap(child.raw, ctx, SNAPSHOT_OPTIONS);

    moveMarkup(doc, parent.id, 10, 10);
    moveMarkup(doc, child.id, -5, 20);

    const parentChanged = changedKeys(beforeParent, keyMap(parent.raw, ctx, SNAPSHOT_OPTIONS));
    expect(parentChanged).toEqual(['AP', 'L', 'M', 'Rect']);
    const childChanged = changedKeys(beforeChild, keyMap(child.raw, ctx, SNAPSHOT_OPTIONS));
    expect(childChanged).toEqual(['M', 'Rect']);

    // The Bluebeam-only keys are exactly what they were.
    for (const key of [
      'RC',
      'DS',
      'BSIColumnData',
      'OC',
      'MeasurementTypes',
      'NM',
      'CreationDate',
    ]) {
      expect(keyMap(parent.raw, ctx, SNAPSHOT_OPTIONS).get(key)).toBe(beforeParent.get(key));
    }
    for (const key of ['IRT', 'RT', 'GroupNesting', 'BSIColumnData', 'NM']) {
      expect(keyMap(child.raw, ctx, SNAPSHOT_OPTIONS).get(key)).toBe(beforeChild.get(key));
    }
    expect(lookupText(parent.raw, 'Contents')).toBe(`80'-0"`);
    expect(child.geometry).toEqual({ kind: 'rect', rect: [295, 620, 495, 720] });
  });
});

describe('saveIncremental', () => {
  it('appends an update section and the result reopens in pdf-lib and pdf.js', async () => {
    const original = await blankArchD();
    const doc = await openDocument(original);
    setPageScale(doc, 0, EIGHTH_INCH, FT_IN_16);
    addLengthMeasurement(
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
    addAreaMeasurement(
      doc,
      0,
      [
        { x: 500, y: 500 },
        { x: 770, y: 500 },
        { x: 770, y: 680 },
        { x: 500, y: 680 },
      ],
      { subject: 'Tile', author: AUTHOR, now: NOW },
    );

    const { bytes, update } = await saveIncremental(doc);
    expect(bytes.length).toBe(original.length + update.length);
    expect(Buffer.from(bytes.subarray(0, original.length)).equals(Buffer.from(original))).toBe(
      true,
    );
    const tail = Buffer.from(update).toString('latin1');
    expect(tail).toMatch(/\/Prev \d+/);
    expect(tail.trimEnd().endsWith('%%EOF')).toBe(true);
    // Plain objects, not an object stream, so the update is inspectable.
    expect(tail).not.toContain('/ObjStm');

    const reopened = await openDocument(bytes);
    expect(reopened.markups).toHaveLength(2);
    const [line, area] = reopened.markups;
    expect(line?.intent).toBe('LineDimension');
    expect(area?.intent).toBe('PolygonDimension');
    // The reopened scale comes from /C rounded to 7 significant digits (ADR-0003).
    expect(line?.measure?.computed.length).toBeCloseTo(80, 3);
    expect(area?.measure?.computed.area).toBeCloseTo(600, 2);
    expect(line?.text?.contents).toBe(`80'-0"`);
    expect(area?.text?.contents).toBe('600 sf');
    expect(line?.render).toBe('native');

    const pdfjs = await loadWithPdfjs(bytes);
    try {
      const page = await pdfjs.doc.getPage(1);
      const annots = await page.getAnnotations();
      expect(annots.map((a: { subtype: string }) => a.subtype).sort()).toEqual(['Line', 'Polygon']);
    } finally {
      await pdfjs.destroy();
    }
  });

  it('moving one markup leaves every other annotation object out of the update', async () => {
    const doc = await openDocument(await syntheticBluebeam());
    const target = requireMarkup(doc, 'CHILDOFGROUPBBBB');
    moveMarkup(doc, target.id, 10, 10);
    const { update } = await saveIncremental(doc);
    const text = Buffer.from(update).toString('latin1');
    const objects = [...text.matchAll(/^(\d+) 0 obj/gm)].map((m) => Number(m[1]));
    // Exactly the moved annotation (plus the trailer's xref) — the parent, the reply,
    // the page and the catalog are untouched.
    expect(objects).toEqual([target.ref.objectNumber]);
    expect(text).not.toContain('BSIAnnotColumns');
    expect(text).not.toContain('BSISpaces');
    expect(text).not.toContain('PARENTGROUPLINEA');
    const annots = doc.pdfDoc.getPage(0).node.Annots();
    expect(annots).toBeInstanceOf(PDFArray);
  });
});
