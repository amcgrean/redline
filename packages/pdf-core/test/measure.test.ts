import { describe, expect, it } from 'vitest';
import type { PDFDict } from '@cantoo/pdf-lib';
import { PDFArray, PDFName, PDFNumber, PDFString } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { buildMeasureDict } from '../src/measure/measureDict.js';
import { parseMeasureDict, readPageScale, setPageScale } from '../src/measure/viewport.js';
import { blankArchD, syntheticBluebeam } from './helpers/synthetic.js';
import { serialize, serializeDict } from './helpers/serialize.js';

const QUARTER_INCH = { pageLength: 0.25, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const EIGHTH_INCH = { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const FT_IN_16 = { display: 'ft-in', precision: 16 } as const;

describe('/Measure dictionary', () => {
  it('matches the snapshot for 1/8 in = 1 ft, feet-inches to 1/16', async () => {
    const doc = await openDocument(await blankArchD());
    const dict = buildMeasureDict(doc.pdfDoc.context, { scale: EIGHTH_INCH, format: FT_IN_16 });
    await expect(serializeDict(dict, doc.pdfDoc.context)).toMatchFileSnapshot(
      './__snapshots__/measure-eighth-ftin16.txt',
    );
  });

  it('matches the snapshot for decimal feet and metric', async () => {
    const doc = await openDocument(await blankArchD());
    const ctx = doc.pdfDoc.context;
    const decimal = buildMeasureDict(ctx, {
      scale: QUARTER_INCH,
      format: { display: 'decimal-ft', precision: 2 },
    });
    const metric = buildMeasureDict(ctx, {
      scale: { pageLength: 1, pageUnit: 'mm', worldLength: 100, worldUnit: 'mm' },
      format: { display: 'm', precision: 3 },
    });
    await expect(
      `${serializeDict(decimal, ctx)}\n\n${serializeDict(metric, ctx)}`,
    ).toMatchFileSnapshot('./__snapshots__/measure-decimal-and-metric.txt');
  });

  it("reproduces Revu's /X /C and /R for 0.25 in = 1 ft", async () => {
    const doc = await openDocument(await blankArchD());
    const dict = buildMeasureDict(doc.pdfDoc.context, {
      scale: QUARTER_INCH,
      format: { display: 'ft-in', precision: 1 },
    });
    const text = serializeDict(dict, doc.pdfDoc.context);
    expect(text).toContain(`/R (0.25 in = 1 ft' in")`);
    expect(text).toContain('/C 0.05555556');
    expect(text).toContain('/SS (-)');
    expect(text).toContain('/U (sf)');
    expect(text).toContain('/TargetUnitConversion 0.001157407');
  });

  it('ignores unitless CAD-export viewports (D-1 style) instead of calling them feet', async () => {
    const doc = await openDocument(await blankArchD());
    const ctx = doc.pdfDoc.context;
    // Shape decoded from fixtures/D-1 Palazzo CF Slab.pdf page 1, entry 0.
    const nf = (c: number) => {
      const d = ctx.obj({}) as PDFDict;
      d.set(PDFName.of('C'), PDFNumber.of(c));
      d.set(PDFName.of('U'), PDFString.of(' '));
      return d;
    };
    const arr = (d: PDFDict) => {
      const a = PDFArray.withContext(ctx);
      a.push(d);
      return a;
    };
    const measure = ctx.obj({}) as PDFDict;
    measure.set(PDFName.of('Type'), PDFName.of('Measure'));
    measure.set(PDFName.of('Subtype'), PDFName.of('RL'));
    measure.set(PDFName.of('R'), PDFString.of(' '));
    measure.set(PDFName.of('X'), arr(nf(0.01389)));
    measure.set(PDFName.of('D'), arr(nf(1)));
    measure.set(PDFName.of('A'), arr(nf(1)));
    expect(parseMeasureDict(measure)).toBeUndefined();
  });

  it('round-trips through parseMeasureDict', async () => {
    const doc = await openDocument(await blankArchD());
    const dict = buildMeasureDict(doc.pdfDoc.context, { scale: EIGHTH_INCH, format: FT_IN_16 });
    const parsed = parseMeasureDict(dict);
    expect(parsed).toBeDefined();
    expect(parsed!.units).toEqual({ display: 'ft-in', precision: 16 });
    // 1/8 in = 1 ft  <=>  1 in = 8 ft
    expect(parsed!.scale.worldLength).toBeCloseTo(8, 5);
    expect(parsed!.scale.worldUnit).toBe('ft');
  });
});

describe('setPageScale', () => {
  it('writes a /VP viewport on a page that had none (snapshot)', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH_INCH, FT_IN_16);
    const page = doc.pdfDoc.getPage(0);
    const vp = page.node.lookup(PDFName.of('VP'));
    expect(vp).toBeInstanceOf(PDFArray);
    const viewport = (vp as PDFArray).lookup(0) as PDFDict;
    // The viewport's /NM is random; blank it for the snapshot.
    const text = serializeDict(viewport, doc.pdfDoc.context).replace(
      /\/NM \([A-Z]{16}\)/,
      '/NM (<16 letters>)',
    );
    await expect(text).toMatchFileSnapshot('./__snapshots__/viewport-eighth-ftin16.txt');
    expect(doc.pageScales.get(0)?.fromDocument).toBe(false);
  });

  it('appends to an existing /VP array without touching the earlier entry', async () => {
    const doc = await openDocument(await syntheticBluebeam());
    const ctx = doc.pdfDoc.context;
    const page = doc.pdfDoc.getPage(0);
    const existingArray = page.node.lookup(PDFName.of('VP')) as PDFArray;
    expect(existingArray.size()).toBe(1);
    const before = serialize(existingArray.get(0), ctx, { depth: 6 });
    expect(doc.pageScales.get(0)?.fromDocument).toBe(true);

    setPageScale(doc, 0, QUARTER_INCH, FT_IN_16);
    const vp = page.node.lookup(PDFName.of('VP')) as PDFArray;
    expect(vp.size()).toBe(2);
    // The pre-existing viewport serialises exactly as it did before.
    expect(serialize(vp.get(0), ctx, { depth: 6 })).toBe(before);
    expect(doc.pageScales.get(0)?.fromDocument).toBe(false);
    expect(doc.pageScales.get(0)?.scale.pageLength).toBe(0.25);
  });

  it('re-calibrating replaces its own viewport instead of stacking', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH_INCH, FT_IN_16);
    setPageScale(doc, 0, QUARTER_INCH, FT_IN_16);
    const vp = doc.pdfDoc.getPage(0).node.lookup(PDFName.of('VP')) as PDFArray;
    expect(vp.size()).toBe(1);
    expect(readPageScale(doc.pdfDoc.getPage(0))?.scale.worldLength).toBeCloseTo(4, 5);
  });

  it('survives an incremental save and reopen', async () => {
    const doc = await openDocument(await blankArchD());
    setPageScale(doc, 0, EIGHTH_INCH, FT_IN_16);
    const { bytes } = await saveIncremental(doc);
    const reopened = await openDocument(bytes);
    const scale = reopened.pageScales.get(0);
    expect(scale?.fromDocument).toBe(true);
    expect(scale?.scale.worldLength).toBeCloseTo(8, 5);
    expect(scale?.units).toEqual(FT_IN_16);
  });
});
