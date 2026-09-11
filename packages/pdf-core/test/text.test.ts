/**
 * Text box, callout and sticky note writers; wrapping; text edits.
 */

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PDFName } from '@cantoo/pdf-lib';
import { openDocument } from '../src/document/open.js';
import { saveIncremental } from '../src/document/save.js';
import { addCallout, addNote, addTextBox, setMarkupText } from '../src/annots/text.js';
import { moveMarkup, setMarkupGeometry } from '../src/annots/write.js';
import { wrapText } from '../src/annots/ap/text.js';
import { escapeLiteral } from '../src/annots/ap/content.js';
import { lookupName, lookupText } from '../src/annots/dict.js';
import { blankArchD } from './helpers/synthetic.js';
import { changedKeys, keyMap, serializeDict } from './helpers/serialize.js';
import { expectPngSnapshot, inkCoverage, renderPng } from './helpers/render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = join(HERE, '__snapshots__');
const NOW = new Date('2026-09-08T10:15:00-05:00');
const LATER = new Date('2026-09-08T11:00:00-05:00');
const AUTHOR = 'Aaron McGrane';
const SNAPSHOT_OPTIONS = { depth: 4, streams: true } as const;

describe('wrapText', () => {
  it('wraps on word boundaries, honours newlines, breaks long words', () => {
    expect(wrapText('short', 10, 200)).toEqual(['short']);
    const lines = wrapText('the quick brown fox jumps over the lazy dog', 10, 100);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(' ')).toBe('the quick brown fox jumps over the lazy dog');
    expect(wrapText('a\nb', 10, 200)).toEqual(['a', 'b']);
    const broken = wrapText('supercalifragilistic', 10, 30);
    expect(broken.length).toBeGreaterThan(1);
    expect(broken.join('')).toBe('supercalifragilistic');
  });
});

describe('unicode text', () => {
  it('keeps an em dash, curly quotes and a degree sign through save and reopen', async () => {
    const doc = await openDocument(await blankArchD());
    const text = 'Plate height \u2014 verify \u201Con site\u201D at 45\u00B0 \u00B11/8"';
    const m = addTextBox(doc, 0, [100, 1500, 400, 1560], {
      subject: 'Ext \u2014 Wall',
      author: 'Aaron \u201CA\u201D McGrane',
      text,
    });
    const { bytes } = await saveIncremental(doc);
    const back = (await openDocument(bytes)).markups[0]!;
    expect(back.text?.contents).toBe(text);
    expect(back.text?.subject).toBe('Ext \u2014 Wall');
    expect(back.text?.author).toBe('Aaron \u201CA\u201D McGrane');
    // Non-Latin-1 text is stored as a hex (UTF-16BE) string.
    expect(m.raw.lookup(PDFName.of('Contents'))?.toString().startsWith('<')).toBe(true);
  });

  it('escapes WinAnsi punctuation into the appearance stream', () => {
    expect(escapeLiteral('a \u2014 b')).toBe('a \\227 b');
    expect(escapeLiteral('\u201Cq\u201D')).toBe('\\223q\\224');
    expect(escapeLiteral('45\u00B0')).toBe('45\\260');
    expect(escapeLiteral('x(y)')).toBe('x\\(y\\)');
  });
});

describe('text markups', () => {
  it('text box: /FreeText with /DA, /DS, /Q, /Contents and an /AP (snapshot)', async () => {
    const doc = await openDocument(await blankArchD());
    const m = addTextBox(doc, 0, [100, 1500, 400, 1560], {
      subject: 'Note',
      author: AUTHOR,
      text: 'Verify plate height on site',
      now: NOW,
      nm: 'TEXTBOXABCDEFGHI',
    });
    expect(m.rawSubtype).toBe('FreeText');
    expect(lookupText(m.raw, 'DA')).toBe('0 0 0 rg /Helv 10 Tf');
    expect(lookupText(m.raw, 'DS')).toBe('font: Helvetica 10pt; text-align:left; color:#000000');
    expect(lookupText(m.raw, 'Contents')).toBe('Verify plate height on site');
    expect(m.raw.has(PDFName.of('AP'))).toBe(true);
    await expect(serializeDict(m.raw, doc.pdfDoc.context, SNAPSHOT_OPTIONS)).toMatchFileSnapshot(
      './__snapshots__/text-box.txt',
    );
  });

  it('auto-sizes the height when given a zero-height rect', async () => {
    const doc = await openDocument(await blankArchD());
    const short = addTextBox(doc, 0, [100, 1500, 300, 1500], {
      subject: 'N',
      author: AUTHOR,
      text: 'one line',
    });
    const long = addTextBox(doc, 0, [100, 1400, 300, 1400], {
      subject: 'N',
      author: AUTHOR,
      text: 'a much longer note that will need to wrap onto several lines inside the box',
    });
    const h = (r: number[]) => r[3]! - r[1]!;
    expect(h(short.rect)).toBeGreaterThan(10);
    // The long note wraps to at least one more line than the short one.
    expect(h(long.rect)).toBeGreaterThan(h(short.rect) + 8);
  });

  it('callout: /IT /FreeTextCallout, /CL with tip-knee-edge, /LE, /RD', async () => {
    const doc = await openDocument(await blankArchD());
    const m = addCallout(
      doc,
      0,
      [600, 1500, 900, 1560],
      { x: 400, y: 1400 },
      { subject: 'Callout', author: AUTHOR, text: 'Missing header', now: NOW },
    );
    expect(lookupName(m.raw, 'IT')).toBe('FreeTextCallout');
    expect(m.intent).toBe('FreeTextCallout');
    const cl = m.raw.lookup(PDFName.of('CL'))?.toString();
    expect(cl).toMatch(/^\[ 400 1400 /);
    expect(m.raw.has(PDFName.of('RD'))).toBe(true);
    // /Rect grew to cover the leader; the text box itself is the geometry.
    expect(m.rect[0]).toBeLessThanOrEqual(400);
    expect(m.geometry.kind === 'rect' && m.geometry.rect).toEqual([600, 1500, 900, 1560]);
  });

  it('note: /Text /Comment with fixed-size flags and an icon', async () => {
    const doc = await openDocument(await blankArchD());
    const m = addNote(
      doc,
      0,
      { x: 200, y: 1000 },
      { subject: 'Note', author: AUTHOR, text: 'Check this', now: NOW },
    );
    expect(m.rawSubtype).toBe('Text');
    expect(lookupName(m.raw, 'Name')).toBe('Comment');
    expect(m.rect).toEqual([200, 980, 220, 1000]);
    expect(m.raw.lookup(PDFName.of('F'))?.toString()).toBe('28');
    expect(m.raw.has(PDFName.of('AP'))).toBe(true);
  });

  it('setMarkupText rewrites Contents, AP, M only and survives reopen', async () => {
    const doc = await openDocument(await blankArchD());
    const m = addTextBox(doc, 0, [100, 1500, 400, 1560], {
      subject: 'N',
      author: AUTHOR,
      text: 'before',
      now: NOW,
    });
    const before = keyMap(m.raw, doc.pdfDoc.context);
    const apBefore = m.raw.get(PDFName.of('AP'))?.toString();
    setMarkupText(doc, m.id, 'after — edited', LATER);
    const after = keyMap(m.raw, doc.pdfDoc.context);
    // keyMap does not read stream bodies and the box did not move, so /AP looks equal
    // there; the appearance object itself is a fresh one.
    expect(changedKeys(before, after).sort()).toEqual(['Contents', 'M']);
    expect(m.raw.get(PDFName.of('AP'))?.toString()).not.toBe(apBefore);
    const { bytes } = await saveIncremental(doc);
    const back = (await openDocument(bytes)).markups[0]!;
    expect(back.text?.contents).toBe('after — edited');
    expect(back.rawSubtype).toBe('FreeText');
  });
});

describe('text edits keep the appearance in step', () => {
  it('resizing a text box re-wraps; moving a callout carries its leader', async () => {
    const doc = await openDocument(await blankArchD());
    const box = addTextBox(doc, 0, [100, 1500, 400, 1560], {
      subject: 'N',
      author: AUTHOR,
      text: 'wrap me please, several words long',
      now: NOW,
    });
    const apBefore = box.raw.get(PDFName.of('AP'))?.toString();
    setMarkupGeometry(doc, box.id, { kind: 'rect', rect: [100, 1400, 250, 1560] }, LATER);
    expect(box.raw.get(PDFName.of('AP'))?.toString()).not.toBe(apBefore);
    expect(box.rect).toEqual([99, 1399, 251, 1561]); // geometry plus 1 pt border pad

    const callout = addCallout(
      doc,
      0,
      [600, 1500, 900, 1560],
      { x: 400, y: 1400 },
      { subject: 'C', author: AUTHOR, text: 'here', now: NOW },
    );
    expect(callout.callout?.[0]).toEqual({ x: 400, y: 1400 });
    moveMarkup(doc, callout.id, 50, -50, LATER);
    expect(callout.callout?.[0]).toEqual({ x: 450, y: 1350 });
    const cl = callout.raw.lookup(PDFName.of('CL'))?.toString();
    expect(cl).toMatch(/^\[ 450 1350 /);
  });
});

describe('text appearances render in pdf.js', () => {
  it('box, callout with leader, note icon, alignment', async () => {
    const doc = await openDocument(await blankArchD());
    addTextBox(doc, 0, [200, 1300, 800, 1300], {
      subject: 'N',
      author: AUTHOR,
      text: 'Left aligned text box that wraps onto a second line when it runs out of room.',
      style: { fontSize: 24, fill: { r: 1, g: 1, b: 0.8 } },
    });
    addTextBox(doc, 0, [1000, 1300, 1600, 1300], {
      subject: 'N',
      author: AUTHOR,
      text: 'Centered\nTwo lines',
      style: { fontSize: 28, align: 'center', stroke: { r: 0, g: 0.3, b: 0.8 }, borderWidth: 3 },
    });
    addCallout(
      doc,
      0,
      [1200, 700, 1800, 700],
      { x: 700, y: 400 },
      {
        subject: 'C',
        author: AUTHOR,
        text: 'Callout pointing at something',
        style: { fontSize: 24 },
      },
    );
    addNote(doc, 0, { x: 300, y: 600 }, { subject: 'Note', author: AUTHOR, text: 'sticky' });
    const { bytes } = await saveIncremental(doc);
    const withAnnots = await renderPng(bytes, { scale: 0.25, annotations: true });
    const without = await renderPng(bytes, { scale: 0.25, annotations: false });
    expect(inkCoverage(withAnnots)).toBeGreaterThan(inkCoverage(without) + 300);
    // Text anti-aliasing differs slightly between Windows and the Linux runner (0.3%).
    expectPngSnapshot(withAnnots, join(SNAPSHOTS, 'ap-text.png'), 0.01);
  });
});
