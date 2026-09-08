/**
 * PNG snapshots of every appearance stream, rendered by pdf.js in Node.
 *
 * pdf.js draws `/AP` streams itself (the same path Chrome takes), so a picture that
 * matches proves the stream is valid PDF content, not just a well-formed dictionary.
 */

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { setPageScale } from '../src/measure/viewport.js';
import { addAreaMeasurement, addLengthMeasurement, moveMarkup } from '../src/annots/write.js';
import { blankArchD } from './helpers/synthetic.js';
import { expectPngSnapshot, inkCoverage, renderPng } from './helpers/render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = join(HERE, '__snapshots__');

const EIGHTH_INCH = { pageLength: 0.125, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' } as const;
const FT_IN_16 = { display: 'ft-in', precision: 16 } as const;
const NOW = new Date('2026-09-08T10:15:00-05:00');
const AUTHOR = 'Aaron McGrean';

async function calibratedBlank() {
  const doc = await openDocument(await blankArchD());
  setPageScale(doc, 0, EIGHTH_INCH, FT_IN_16);
  return doc;
}

describe('appearance streams render in pdf.js', () => {
  it('length: arrowheads, leaders and caption', async () => {
    const doc = await calibratedBlank();
    addLengthMeasurement(
      doc,
      0,
      { x: 300, y: 900 },
      { x: 1020, y: 900 },
      {
        subject: 'Wall',
        author: AUTHOR,
        now: NOW,
      },
    );
    addLengthMeasurement(
      doc,
      0,
      { x: 1300, y: 300 },
      { x: 1300, y: 1200 },
      {
        subject: 'Wall',
        author: AUTHOR,
        now: NOW,
        style: { lineEnds: ['Slash', 'Slash'], leaderLength: -10, stroke: { r: 1, g: 0, b: 0 } },
      },
    );
    addLengthMeasurement(
      doc,
      0,
      { x: 1500, y: 400 },
      { x: 2200, y: 1100 },
      {
        subject: 'Diag',
        author: AUTHOR,
        now: NOW,
        style: { lineEnds: ['OpenArrow', 'Butt'], dash: [6, 3], opacity: 0.6 },
      },
    );
    const { bytes } = await saveIncremental(doc);
    const withAnnots = await renderPng(bytes, { scale: 0.25, annotations: true });
    const without = await renderPng(bytes, { scale: 0.25, annotations: false });
    // The annotations must add ink; otherwise pdf.js silently ignored the /AP.
    expect(inkCoverage(withAnnots)).toBeGreaterThan(inkCoverage(without) + 500);
    expectPngSnapshot(withAnnots, join(SNAPSHOTS, 'ap-length.png'));
  });

  it('area: translucent fill, outline and centred caption', async () => {
    const doc = await calibratedBlank();
    addAreaMeasurement(
      doc,
      0,
      [
        { x: 400, y: 400 },
        { x: 1200, y: 400 },
        { x: 1200, y: 900 },
        { x: 900, y: 900 },
        { x: 900, y: 1300 },
        { x: 400, y: 1300 },
      ],
      { subject: 'Floor', author: AUTHOR, now: NOW },
    );
    addAreaMeasurement(
      doc,
      0,
      [
        { x: 1500, y: 500 },
        { x: 2300, y: 500 },
        { x: 1900, y: 1300 },
      ],
      {
        subject: 'Roof',
        author: AUTHOR,
        now: NOW,
        style: {
          stroke: { r: 0.8, g: 0.1, b: 0.1 },
          fill: { r: 1, g: 0.8, b: 0 },
          fillOpacity: 0.5,
          dash: [4, 4],
        },
      },
    );
    const { bytes } = await saveIncremental(doc);
    const withAnnots = await renderPng(bytes, { scale: 0.25, annotations: true });
    const without = await renderPng(bytes, { scale: 0.25, annotations: false });
    expect(inkCoverage(withAnnots)).toBeGreaterThan(inkCoverage(without) + 5000);
    expectPngSnapshot(withAnnots, join(SNAPSHOTS, 'ap-area.png'));
  });

  it('a moved measurement renders at its new position with the same caption', async () => {
    const doc = await calibratedBlank();
    const m = addLengthMeasurement(
      doc,
      0,
      { x: 300, y: 900 },
      { x: 1020, y: 900 },
      {
        subject: 'Wall',
        author: AUTHOR,
        now: NOW,
      },
    );
    moveMarkup(doc, m.id, 400, -300, NOW);
    const { bytes } = await saveIncremental(doc);
    const png = await renderPng(bytes, { scale: 0.25, annotations: true });
    expectPngSnapshot(png, join(SNAPSHOTS, 'ap-length-moved.png'));
  });
});

describe('captions are legible text, not just ink', () => {
  it('renders the Helvetica caption at 100% zoom', async () => {
    const doc = await calibratedBlank();
    addLengthMeasurement(
      doc,
      0,
      { x: 300, y: 900 },
      { x: 1020, y: 900 },
      {
        subject: 'Wall',
        author: AUTHOR,
        now: NOW,
      },
    );
    const { bytes } = await saveIncremental(doc);
    // Full-resolution render of the sheet; the caption occupies a ~40x8 pt patch above
    // the line's midpoint. Crop it out so the snapshot stays small and meaningful.
    const png = await renderPng(bytes, { scale: 1, annotations: true });
    const { PNG } = await import('pngjs');
    const full = PNG.sync.read(png);
    const crop = new PNG({ width: 160, height: 60 });
    // Page is 1728 pt tall; y=900 in PDF space is 828 px from the top at scale 1.
    const cx = 660 - 80;
    const cy = 1728 - 900 - 45;
    PNG.bitblt(full, crop, cx, cy, 160, 60, 0, 0);
    const cropped = PNG.sync.write(crop);
    expect(inkCoverage(cropped)).toBeGreaterThan(60);
    expectPngSnapshot(cropped, join(SNAPSHOTS, 'ap-caption-crop.png'), 0.01);
  });
});
