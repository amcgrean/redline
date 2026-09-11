/**
 * Per-markup scale override (PLAN §3.7): set, survive reopen and page recalibration,
 * clear; a Revu-style markup whose own /Measure differs from the page reads its own.
 */

import { describe, expect, it } from 'vitest';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { setPageScale } from '../src/measure/viewport.js';
import { addLengthMeasurement, clearMarkupScale, setMarkupScale } from '../src/annots/write.js';
import { sameScale } from '../src/measure/units.js';
import { blankArchD } from './helpers/synthetic.js';

const EIGHTH = { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const QUARTER = { pageLength: 0.25, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const FTIN16 = { display: 'ft-in', precision: 16 } as const;

describe('per-markup scale', () => {
  it('overrides one measurement, survives reopen and recalibration, and clears', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    const a = addLengthMeasurement(
      doc,
      0,
      { x: 100, y: 100 },
      { x: 820, y: 100 },
      {
        subject: 'A',
        author: 'T',
      },
    );
    const b = addLengthMeasurement(
      doc,
      0,
      { x: 100, y: 300 },
      { x: 820, y: 300 },
      {
        subject: 'B',
        author: 'T',
      },
    );
    expect(a.measure?.computed.length).toBeCloseTo(80, 6);
    setMarkupScale(doc, a.id, QUARTER, FTIN16);
    expect(a.measure?.own).toBe(true);
    expect(a.measure?.computed.length).toBeCloseTo(40, 6);
    expect(a.text?.contents).toBe(`40'-0"`);
    expect(b.measure?.computed.length).toBeCloseTo(80, 6);

    let back = await openDocument((await saveIncremental(doc)).bytes);
    const a2 = back.markups.find((m) => m.text?.subject === 'A')!;
    const b2 = back.markups.find((m) => m.text?.subject === 'B')!;
    expect(a2.measure?.own).toBe(true);
    expect(a2.measure?.computed.length).toBeCloseTo(40, 4);
    expect(b2.measure?.own).toBeUndefined();
    expect(b2.measure?.computed.length).toBeCloseTo(80, 4);

    // Recalibrating the page changes B, not A.
    setPageScale(doc, 0, { ...EIGHTH, worldLength: 2 }, FTIN16);
    expect(b.measure?.computed.length).toBeCloseTo(160, 6);
    expect(a.measure?.computed.length).toBeCloseTo(40, 6);

    clearMarkupScale(doc, a.id);
    expect(a.measure?.own).toBeUndefined();
    expect(a.measure?.computed.length).toBeCloseTo(160, 6);
    back = await openDocument((await saveIncremental(doc)).bytes);
    expect(back.markups.find((m) => m.text?.subject === 'A')!.measure?.own).toBeUndefined();
  });

  it('sameScale tolerates float noise and rejects different units', () => {
    expect(sameScale(EIGHTH, { ...EIGHTH, worldLength: 1.0000000001 })).toBe(true);
    expect(sameScale(EIGHTH, QUARTER)).toBe(false);
    expect(sameScale(EIGHTH, { ...EIGHTH, worldUnit: 'm' })).toBe(false);
  });
});
