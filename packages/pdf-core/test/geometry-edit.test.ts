/**
 * setMarkupGeometry: vertex edits recompute the value and caption; /RC stays in sync.
 */

import { describe, expect, it } from 'vitest';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { setPageScale } from '../src/measure/viewport.js';
import {
  addLengthMeasurement,
  addAreaMeasurement,
  setMarkupGeometry,
} from '../src/annots/write.js';
import { lookupText } from '../src/annots/dict.js';
import { blankArchD, syntheticBluebeam } from './helpers/synthetic.js';
import { changedKeys, keyMap } from './helpers/serialize.js';

const EIGHTH = { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const FTIN16 = { display: 'ft-in', precision: 16 } as const;
const NOW = new Date('2026-09-08T10:15:00-05:00');
const LATER = new Date('2026-09-08T11:00:00-05:00');
const AUTHOR = 'Aaron McGrane';

describe('setMarkupGeometry', () => {
  it('moving a length endpoint changes L, Rect, AP, Contents, M and the value', async () => {
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
    expect(m.text?.contents).toBe(`80'-0"`);
    const before = keyMap(m.raw, doc.pdfDoc.context);
    setMarkupGeometry(
      doc,
      m.id,
      {
        kind: 'line',
        points: [
          { x: 100, y: 100 },
          { x: 1000, y: 100 },
        ],
      },
      LATER,
    );
    const after = keyMap(m.raw, doc.pdfDoc.context);
    expect(changedKeys(before, after).sort()).toEqual(['AP', 'Contents', 'L', 'M', 'Rect']);
    expect(m.text?.contents).toBe(`100'-0"`);
    expect(m.measure?.computed.length).toBeCloseTo(100, 6);

    const { bytes } = await saveIncremental(doc);
    const back = (await openDocument(bytes)).markups[0]!;
    expect(lookupText(back.raw, 'Contents')).toBe(`100'-0"`);
    expect(back.measure?.computed.length).toBeCloseTo(100, 3);
  });

  it('editing an area vertex recomputes the square footage', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    const room = [
      { x: 100, y: 100 },
      { x: 370, y: 100 },
      { x: 370, y: 280 },
      { x: 100, y: 280 },
    ];
    const m = addAreaMeasurement(doc, 0, room, { subject: 'Tile', author: AUTHOR, now: NOW });
    expect(m.text?.contents).toBe('600 sf');
    // Stretch the room to 40 x 20 ft.
    setMarkupGeometry(doc, m.id, {
      kind: 'poly',
      closed: true,
      points: [room[0]!, { x: 460, y: 100 }, { x: 460, y: 280 }, room[3]!],
    });
    expect(m.text?.contents).toBe('800 sf');
  });

  it('keeps Revu rich text in step with the new value and touches no Bluebeam key', async () => {
    const doc = await openDocument(await syntheticBluebeam());
    const line = doc.markups.find((m) => m.intent === 'LineDimension' && m.text?.richText);
    expect(line).toBeDefined();
    expect(line!.geometry.kind).toBe('line');
    const before = keyMap(line!.raw, doc.pdfDoc.context);
    const [a, b] = line!.geometry.kind === 'line' ? line!.geometry.points : [];
    setMarkupGeometry(
      doc,
      line!.id,
      { kind: 'line', points: [a!, { x: b!.x + 180, y: b!.y }] },
      LATER,
    );
    const after = keyMap(line!.raw, doc.pdfDoc.context);
    expect(changedKeys(before, after).sort()).toEqual(['AP', 'Contents', 'L', 'M', 'RC', 'Rect']);
    const contents = lookupText(line!.raw, 'Contents')!;
    expect(contents).toMatch(/'-/);
    expect(lookupText(line!.raw, 'RC')).toContain(`>${contents}</body>`);
    // Bluebeam keys ride along untouched.
    for (const key of ['BSIColumnData', 'DS', 'MeasurementTypes', 'NM', 'CreationDate']) {
      expect(after.get(key)).toBe(before.get(key));
    }
  });

  it('a foreign rectangle keeps its appearance stream and just gets a new /Rect', async () => {
    const doc = await openDocument(await syntheticBluebeam());
    const square = doc.markups.find((m) => m.rawSubtype === 'Square' || m.rawSubtype === 'Stamp');
    expect(square).toBeDefined();
    const before = keyMap(square!.raw, doc.pdfDoc.context);
    const [x0, y0, x1, y1] = square!.rect;
    setMarkupGeometry(
      doc,
      square!.id,
      {
        kind: square!.geometry.kind === 'rect' ? 'rect' : 'none',
        rect: [x0, y0, x1 + 50, y1 + 30],
      } as never,
      LATER,
    );
    const after = keyMap(square!.raw, doc.pdfDoc.context);
    expect(changedKeys(before, after).sort()).toEqual(['M', 'Rect']);
    expect(square!.rect).toEqual([x0, y0, x1 + 50, y1 + 30]);
  });

  it('refuses to change the geometry kind', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    const m = addLengthMeasurement(
      doc,
      0,
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { subject: 'x', author: AUTHOR },
    );
    expect(() => setMarkupGeometry(doc, m.id, { kind: 'rect', rect: [0, 0, 1, 1] })).toThrow(
      /kind/,
    );
  });
});
