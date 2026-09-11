/**
 * Populate `fixtures/out/` for the manual interop checklist (docs/interop-checklist.md).
 *
 *   1. spike-0.1-blank-archd.pdf — a blank ARCH D sheet with one page scale (1/8" = 1'-0",
 *      feet-inches to 1/16), one 80'-0" length and one 600 sf area.
 *   1b. spike-0.2-measurements.pdf — the rest of the v1 measurement family on the same sheet:
 *      a 120'-0" polylength, a 100'-0" perimeter, a 200 sf rectangle area and a count of five.
 *      Perimeter (closed polyline) and count (plain circles + /RLAttrs) are the two forms whose
 *      Revu handling is ASSUMED — this is the file that checks them.
 *   2. corpus/<fixture>.moved.pdf — every fixture re-saved after moving one markup 10 pt.
 *      (The corpus test writes these too; this script regenerates them without vitest.)
 *
 * Run with: pnpm fixtures:out   (vite-node, so it works on Node 20 as well as 22)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { deletePages, movePages, rotatePages, saveFull } from '../src/pages/ops.js';
import { addStamp, embedStampArtwork, rectAt, stampPages } from '../src/stamps/stamp.js';
import { bakeFields } from '../src/stamps/fields.js';
import { createRequire } from 'node:module';
import { createQpdfRunner, type QpdfModuleFactory } from '../src/compress/emscripten.js';
import { describeSavings, optimizePdf } from '../src/compress/optimize.js';
import { setPageScale } from '../src/measure/viewport.js';
import {
  addAreaMeasurement,
  addCountMarkup,
  addLengthMeasurement,
  addPolylineMeasurement,
  moveMarkup,
} from '../src/annots/write.js';
import { generateNM } from '../src/ids.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = resolve(HERE, '../../../fixtures');
const OUT = join(FIXTURES, 'out');
const AUTHOR = 'Aaron McGrean';

async function blankArchD(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([2592, 1728]);
  page.drawRectangle({
    x: 36,
    y: 36,
    width: 2592 - 72,
    height: 1728 - 72,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6),
  });
  page.drawText('Redline POC — spike 0.1 — ARCH D, 1/8" = 1\'-0"', {
    x: 60,
    y: 1728 - 90,
    size: 24,
    color: rgb(0.3, 0.3, 0.3),
  });
  return doc.save({ useObjectStreams: false });
}

async function spike01(): Promise<void> {
  const doc = await openDocument(await blankArchD());
  setPageScale(
    doc,
    0,
    { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' },
    { display: 'ft-in', precision: 16 },
  );
  // 720 pt at 9 pt/ft = 80'-0"
  addLengthMeasurement(
    doc,
    0,
    { x: 300, y: 1300 },
    { x: 1020, y: 1300 },
    {
      subject: 'Ext Wall 2x6',
      author: AUTHOR,
    },
  );
  // 30 x 20 ft = 600 sf
  addAreaMeasurement(
    doc,
    0,
    [
      { x: 300, y: 500 },
      { x: 570, y: 500 },
      { x: 570, y: 680 },
      { x: 300, y: 680 },
    ],
    { subject: 'Tile', author: AUTHOR },
  );
  // A second length at 45 degrees with Revu-style slash endings, to compare rendering.
  addLengthMeasurement(
    doc,
    0,
    { x: 1300, y: 500 },
    { x: 1900, y: 1100 },
    {
      subject: 'Diagonal',
      author: AUTHOR,
      style: { lineEnds: ['Slash', 'Slash'], leaderLength: -10, stroke: { r: 1, g: 0, b: 0 } },
    },
  );
  const { bytes } = await saveIncremental(doc);
  writeFileSync(join(OUT, 'spike-0.1-blank-archd.pdf'), bytes);
  console.log('wrote spike-0.1-blank-archd.pdf');
}

async function spike02(): Promise<void> {
  const doc = await openDocument(await blankArchD());
  setPageScale(
    doc,
    0,
    { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' },
    { display: 'ft-in', precision: 16 },
  );
  // Polylength: 80' right, 40' up = 120'-0".
  addPolylineMeasurement(
    doc,
    0,
    [
      { x: 300, y: 1300 },
      { x: 1020, y: 1300 },
      { x: 1020, y: 1660 },
    ],
    { subject: 'Base Trim', author: AUTHOR, style: { lineEnds: ['Slash', 'Slash'] } },
  );
  // Perimeter of a 30 x 20 ft room = 100'-0".
  addPolylineMeasurement(
    doc,
    0,
    [
      { x: 300, y: 500 },
      { x: 570, y: 500 },
      { x: 570, y: 680 },
      { x: 300, y: 680 },
    ],
    { subject: 'Room Perimeter', author: AUTHOR, closed: true, style: { dash: [8, 4] } },
  );
  // Rectangle area 20 x 10 ft = 200 sf (what the Rect Area tool writes).
  addAreaMeasurement(
    doc,
    0,
    [
      { x: 1300, y: 500 },
      { x: 1480, y: 500 },
      { x: 1480, y: 590 },
      { x: 1300, y: 590 },
    ],
    { subject: 'Slab', author: AUTHOR },
  );
  // Count of five studs.
  const group = generateNM();
  for (let i = 0; i < 5; i += 1) {
    addCountMarkup(
      doc,
      0,
      { x: 1300 + i * 90, y: 1000 },
      { subject: 'Studs', author: AUTHOR, group },
    );
  }
  const { bytes } = await saveIncremental(doc);
  writeFileSync(join(OUT, 'spike-0.2-measurements.pdf'), bytes);
  console.log('wrote spike-0.2-measurements.pdf');
}

async function corpusMoved(): Promise<void> {
  const corpusOut = join(OUT, 'corpus');
  mkdirSync(corpusOut, { recursive: true });
  for (const name of readdirSync(FIXTURES).filter((f) => f.toLowerCase().endsWith('.pdf'))) {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, name)));
    const doc = await openDocument(bytes);
    const target =
      doc.markups.find((m) => m.geometry.kind === 'line' || m.geometry.kind === 'poly') ??
      doc.markups[0];
    if (!target) {
      console.log(`skip ${name}: no annotations`);
      continue;
    }
    moveMarkup(doc, target.id, 10, 10);
    const { bytes: out, update } = await saveIncremental(doc);
    const outName = `${basename(name, '.pdf')}.moved.pdf`;
    writeFileSync(join(corpusOut, outName), out);
    console.log(
      `wrote corpus/${outName} — moved ${target.rawSubtype} ${target.id} on page ${target.pageIndex + 1} (+${update.length} bytes)`,
    );
  }
}

/**
 * 4. Page operations on the Revu fixture (ADR 0004): a full rewrite after rotate + reorder,
 *    and after a delete. Interop checklist rows 11a/11b.
 */
async function pages04(): Promise<void> {
  const revu = readdirSync(FIXTURES).find((f) => /bluebeam/i.test(f) && f.endsWith('.pdf'));
  if (!revu) {
    console.log('skip pages-0.4: no Revu fixture');
    return;
  }
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, revu)));
  let doc = await openDocument(bytes);
  const count = doc.pdfDoc.getPageCount();
  rotatePages(doc, [0], 90);
  if (count > 1) movePages(doc, [count - 1], 0);
  writeFileSync(join(OUT, 'pages-0.4-revu-rotated-reordered.pdf'), await saveFull(doc));
  console.log(`wrote pages-0.4-revu-rotated-reordered.pdf (${count} pages)`);
  if (count > 1) {
    doc = await openDocument(bytes);
    deletePages(doc, [1]);
    writeFileSync(join(OUT, 'pages-0.4-revu-deleted.pdf'), await saveFull(doc));
    console.log('wrote pages-0.4-revu-deleted.pdf');
  }
}

/**
 * 5. Stamps on the Revu fixture: a built-in text stamp on page 1, a vector PDF stamp on
 *    page 1, and RECEIVED on every page top-right. Interop checklist row 9.
 */
async function stamps05(): Promise<void> {
  const revu = readdirSync(FIXTURES).find((f) => /bluebeam/i.test(f) && f.endsWith('.pdf'));
  if (!revu) {
    console.log('skip stamps-0.5: no Revu fixture');
    return;
  }
  const doc = await openDocument(new Uint8Array(readFileSync(join(FIXTURES, revu))));
  const now = new Date();
  const approved = await embedStampArtwork(doc, {
    kind: 'text',
    lines: ['APPROVED', bakeFields('{user} · {date}', { now, user: 'Aaron McGrane' })],
    color: { r: 0.13, g: 0.55, b: 0.13 },
  });
  addStamp(doc, 0, rectAt(approved, { x: 120, y: 1600 }, 260), approved, {
    name: 'RedlineApproved',
    contents: `APPROVED Aaron McGrane · ${bakeFields('{date}', { now, user: '' })}`,
    author: 'Aaron McGrane',
    now,
  });
  const art = await PDFDocument.create({ updateMetadata: false });
  const page = art.addPage([300, 120]);
  page.drawEllipse({
    x: 150,
    y: 60,
    xScale: 140,
    yScale: 50,
    borderColor: rgb(0.8, 0.1, 0.1),
    borderWidth: 4,
  });
  page.drawText('VECTOR STAMP', { x: 60, y: 50, size: 22, color: rgb(0.8, 0.1, 0.1) });
  const vector = await embedStampArtwork(doc, { kind: 'pdf', bytes: await art.save() });
  addStamp(doc, 0, rectAt(vector, { x: 420, y: 1600 }, 300), vector, {
    name: 'RedlineVector',
    contents: 'VECTOR STAMP',
    author: 'Aaron McGrane',
    now,
    rotation: 90,
    opacity: 0.6,
  });
  const received = await embedStampArtwork(doc, {
    kind: 'text',
    lines: ['RECEIVED', bakeFields('{date} {time}', { now, user: '' })],
    color: { r: 0.1, g: 0.35, b: 0.75 },
  });
  stampPages(
    doc,
    received,
    { corner: 'top-right', width: 216, margin: 36 },
    {
      name: 'RedlineReceived',
      contents: `RECEIVED ${bakeFields('{date} {time}', { now, user: '' })}`,
      author: 'Aaron McGrane',
      now,
    },
  );
  writeFileSync(join(OUT, 'stamps-0.5-revu.pdf'), (await saveIncremental(doc)).bytes);
  console.log('wrote stamps-0.5-revu.pdf');
}

/**
 * 6. Optimize (lossless, qpdf) on the Revu fixture. Interop checklist row C1.
 */
async function compress06(): Promise<void> {
  const revu = readdirSync(FIXTURES).find((f) => /bluebeam/i.test(f) && f.endsWith('.pdf'));
  if (!revu) {
    console.log('skip compress-0.6: no Revu fixture');
    return;
  }
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('@jspawn/qpdf-wasm/qpdf.wasm');
  const init = (await import('@jspawn/qpdf-wasm/qpdf.mjs')).default as QpdfModuleFactory;
  // See test/compress.test.ts: this build fetches the .wasm in Node unless streaming fails.
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
  const runner = createQpdfRunner(factory, { locateFile: () => wasm });
  const input = new Uint8Array(readFileSync(join(FIXTURES, revu)));
  const report = await optimizePdf(runner, input);
  writeFileSync(join(OUT, 'compress-0.6-revu-optimized.pdf'), report.bytes);
  console.log(`wrote compress-0.6-revu-optimized.pdf — ${describeSavings(report)}`);
}

if (!existsSync(FIXTURES)) throw new Error(`fixtures directory missing: ${FIXTURES}`);
mkdirSync(OUT, { recursive: true });
await spike01();
await spike02();
await pages04();
await stamps05();
await compress06();
if (!process.argv.includes('--spikes-only')) await corpusMoved();
