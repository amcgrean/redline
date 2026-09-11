/**
 * Tool id and attribute values on markups: /RLTool and /RLAttrs written at creation, read
 * back, merged on edit, and left alone by moves.
 */

import { describe, expect, it } from 'vitest';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { setPageScale } from '../src/measure/viewport.js';
import {
  addLengthMeasurement,
  addCountMarkup,
  moveMarkup,
  updateMarkupProperties,
  countGroupOf,
} from '../src/annots/write.js';
import { addShapeMarkup } from '../src/annots/shapes.js';
import { lookupText } from '../src/annots/dict.js';
import { blankArchD } from './helpers/synthetic.js';

const EIGHTH = { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const FTIN16 = { display: 'ft-in', precision: 16 } as const;

describe('tool attributes', () => {
  it('writes /RLTool and /RLAttrs and reads them back', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    const m = addLengthMeasurement(
      doc,
      0,
      { x: 100, y: 100 },
      { x: 820, y: 100 },
      {
        subject: 'Wall',
        author: 'T',
        tool: 'TOOL1',
        attrs: { height: 9, studSpacing: 16, note: 'exterior' },
      },
    );
    expect(lookupText(m.raw, 'RLTool')).toBe('TOOL1');
    expect(JSON.parse(lookupText(m.raw, 'RLAttrs')!)).toEqual({
      height: 9,
      studSpacing: 16,
      note: 'exterior',
    });
    const shape = addShapeMarkup(
      doc,
      0,
      { kind: 'rectangle', rect: [0, 0, 100, 100] },
      {
        subject: 'Box',
        author: 'T',
        tool: 'TOOL2',
      },
    );
    expect(lookupText(shape.raw, 'RLTool')).toBe('TOOL2');
    expect(shape.raw.has(lookupTextKey('RLAttrs'))).toBe(false);

    const back = await openDocument((await saveIncremental(doc)).bytes);
    const wall = back.markups.find((x) => x.text?.subject === 'Wall')!;
    expect(wall.tool).toBe('TOOL1');
    expect(wall.attrs).toEqual({ height: 9, studSpacing: 16, note: 'exterior' });
    expect(back.markups.find((x) => x.text?.subject === 'Box')!.tool).toBe('TOOL2');
  });

  it('merges attribute edits and keeps them through a move', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    const m = addLengthMeasurement(
      doc,
      0,
      { x: 100, y: 100 },
      { x: 820, y: 100 },
      {
        subject: 'Wall',
        author: 'T',
        tool: 'TOOL1',
        attrs: { height: 9 },
      },
    );
    updateMarkupProperties(doc, m.id, { attrs: { height: 10, layers: 2 } });
    expect(m.attrs).toEqual({ height: 10, layers: 2 });
    moveMarkup(doc, m.id, 5, 5);
    const back = await openDocument((await saveIncremental(doc)).bytes);
    expect(back.markups[0]!.attrs).toEqual({ height: 10, layers: 2 });
    expect(back.markups[0]!.tool).toBe('TOOL1');
    expect(back.markups[0]!.measure?.computed.length).toBeCloseTo(80, 4);
  });

  it('a count symbol keeps its group when made with a chest tool', async () => {
    const doc = await openDocument(await blankArchD());
    const c = addCountMarkup(
      doc,
      0,
      { x: 50, y: 50 },
      {
        subject: 'Outlet',
        author: 'T',
        group: 'GROUPAAAAAAAAAAA',
        tool: 'TOOLC',
        attrs: { circuit: 'A' },
      },
    );
    expect(countGroupOf(c)).toBe('GROUPAAAAAAAAAAA');
    expect(c.tool).toBe('TOOLC');
    expect(c.attrs).toEqual({ circuit: 'A', count: 1, group: 'GROUPAAAAAAAAAAA' });
    const back = await openDocument((await saveIncremental(doc)).bytes);
    expect(countGroupOf(back.markups[0]!)).toBe('GROUPAAAAAAAAAAA');
  });
});

function lookupTextKey(name: string) {
  return { asString: () => `/${name}` } as never;
}
