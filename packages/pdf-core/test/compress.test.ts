/**
 * Compress / Optimize through qpdf (WASM, run in Node): smaller output, markups intact,
 * structural check, error handling.
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { setPageScale } from '../src/measure/viewport.js';
import { addLengthMeasurement } from '../src/annots/write.js';
import { addTextBox } from '../src/annots/text.js';
import { createQpdfRunner, type QpdfModuleFactory } from '../src/compress/emscripten.js';
import { checkPdf, describeSavings, formatBytes, optimizePdf } from '../src/compress/optimize.js';
import { blankArchD, syntheticBluebeam } from './helpers/synthetic.js';

const require = createRequire(import.meta.url);
const WASM = require.resolve('@jspawn/qpdf-wasm/qpdf.wasm');

/**
 * The jspawn build predates Emscripten's `wasmBinary` option and, in Node, tries `fetch`
 * on a plain file path. A throw-away `fetch` during init makes streaming compile fail
 * fast, after which the module falls back to `fs.readFileSync` on the located path.
 */
async function runner() {
  const init = (await import('@jspawn/qpdf-wasm/qpdf.mjs')).default as QpdfModuleFactory;
  const factory: QpdfModuleFactory = async (options) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(), {
        headers: { 'content-type': 'text/plain' },
      })) as typeof fetch;
    try {
      return await init(options);
    } finally {
      globalThis.fetch = realFetch;
    }
  };
  return createQpdfRunner(factory, { locateFile: () => WASM });
}

const EIGHTH = { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const FTIN16 = { display: 'ft-in', precision: 16 } as const;

describe('optimizePdf', () => {
  it('shrinks an incrementally-saved file and keeps every markup', async () => {
    const doc = await openDocument(await syntheticBluebeam());
    setPageScale(doc, 0, EIGHTH, FTIN16);
    for (let i = 0; i < 20; i += 1) {
      addLengthMeasurement(
        doc,
        0,
        { x: 100, y: 100 + i * 40 },
        { x: 900, y: 100 + i * 40 },
        {
          subject: 'Wall',
          author: 'T',
        },
      );
    }
    addTextBox(doc, 0, [100, 1200, 600, 1300], { subject: 'Text', author: 'T', text: 'hello' });
    const input = (await saveIncremental(doc)).bytes;
    const before = await openDocument(input);

    const q = await runner();
    const report = await optimizePdf(q, input);
    expect(report.before).toBe(input.length);
    expect(report.after).toBeLessThan(report.before);
    expect(report.saved).toBeGreaterThan(0.05);
    expect(report.bytes.subarray(0, 5)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));

    const after = await openDocument(report.bytes);
    expect(after.markups.map((m) => m.id).sort()).toEqual(before.markups.map((m) => m.id).sort());
    for (const m of before.markups) {
      const o = after.markups.find((x) => x.id === m.id)!;
      expect([...o.raw.keys()].map((k) => k.asString()).sort()).toEqual(
        [...m.raw.keys()].map((k) => k.asString()).sort(),
      );
    }
    expect(after.pageScales.get(0)?.scale.worldLength).toBe(
      before.pageScales.get(0)?.scale.worldLength,
    );
    expect(await checkPdf(q, report.bytes)).toBe(true);
  }, 120_000);

  it('throws on garbage input and formats savings', async () => {
    const q = await runner();
    await expect(optimizePdf(q, new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/qpdf failed/);
    expect(describeSavings({ before: 1_572_864, after: 1_153_434, saved: 0.2667 })).toBe(
      '1.5 MB → 1.1 MB (27% smaller)',
    );
    expect(describeSavings({ before: 1000, after: 1100, saved: -0.1 })).toBe(
      '1000 B → 1 KB (10% larger)',
    );
    expect(formatBytes(2048)).toBe('2 KB');
  }, 60_000);

  it('a plain pdf-lib file survives too', async () => {
    const q = await runner();
    const input = await blankArchD();
    const report = await optimizePdf(q, input);
    expect((await openDocument(report.bytes)).pdfDoc.getPageCount()).toBe(1);
  }, 60_000);
});
