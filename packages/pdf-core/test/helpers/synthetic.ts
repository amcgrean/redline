/**
 * Synthetic PDFs for unit tests. Real Revu-authored files live in `fixtures/`; these
 * exist so the writers and the ownership rules can be exercised deterministically, and
 * so preservation of Bluebeam keys is tested even when a fixture lacks them.
 */

import type { PDFDict } from '@cantoo/pdf-lib';
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  rgb,
  type PDFContext,
} from '@cantoo/pdf-lib';

/** ARCH D landscape: 36 x 24 in = 2592 x 1728 pt — the sheet size in the Revu fixture. */
export const ARCH_D: [number, number] = [2592, 1728];

/** A blank ARCH D sheet with a light border so renders are visibly a page. */
export async function blankArchD(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(ARCH_D);
  page.drawRectangle({
    x: 36,
    y: 36,
    width: ARCH_D[0] - 72,
    height: ARCH_D[1] - 72,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6),
  });
  return doc.save({ useObjectStreams: false });
}

function nm(context: PDFContext, value: string): PDFString {
  void context;
  return PDFString.of(value);
}

function numbers(context: PDFContext, values: number[]): PDFArray {
  const arr = PDFArray.withContext(context);
  for (const v of values) arr.push(PDFNumber.of(v));
  return arr;
}

/**
 * A one-page PDF dressed up with the Bluebeam keys the corpus test must keep byte-identical:
 * page `/BSISpaces`, catalog `/BSIAnnotColumns`, per-annotation `/BSIColumnData`, `/RC`,
 * a group (`/RT /Group` + `/IRT`), a layer (`/OC`), and a pre-existing `/VP` entry.
 *
 * The values are shaped like Revu's but are NOT decoded from a real file — the fixture
 * corpus has none of these keys yet. Marked ASSUMED in the PR summary.
 */
export async function syntheticBluebeam(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const context = doc.context;
  const page = doc.addPage(ARCH_D);

  // Catalog: custom column definitions.
  const columns = PDFArray.withContext(context);
  columns.push(PDFString.of('Cost Code'));
  columns.push(PDFString.of('Phase'));
  doc.catalog.set(PDFName.of('BSIAnnotColumns'), columns);

  // Page: a space, and a pre-existing viewport at 1/8 in = 1 ft.
  const space = context.obj({}) as PDFDict;
  space.set(PDFName.of('Title'), PDFString.of('Garage'));
  space.set(PDFName.of('Path'), numbers(context, [100, 100, 900, 100, 900, 700, 100, 700]));
  const spaces = PDFArray.withContext(context);
  spaces.push(context.register(space));
  page.node.set(PDFName.of('BSISpaces'), spaces);

  const measure = context.obj({}) as PDFDict;
  measure.set(PDFName.of('Type'), PDFName.of('Measure'));
  measure.set(PDFName.of('Subtype'), PDFName.of('RL'));
  measure.set(PDFName.of('R'), PDFString.of('0.125 in = 1 ft\' in"'));
  const x = context.obj({}) as PDFDict;
  x.set(PDFName.of('Type'), PDFName.of('NumberFormat'));
  x.set(PDFName.of('U'), PDFString.of("'"));
  x.set(PDFName.of('C'), PDFNumber.of(0.1111111));
  x.set(PDFName.of('F'), PDFName.of('F'));
  x.set(PDFName.of('D'), PDFNumber.of(16));
  x.set(PDFName.of('FD'), context.obj(true));
  const xArr = PDFArray.withContext(context);
  xArr.push(x);
  measure.set(PDFName.of('X'), xArr);
  const dFeet = context.obj({}) as PDFDict;
  dFeet.set(PDFName.of('Type'), PDFName.of('NumberFormat'));
  dFeet.set(PDFName.of('U'), PDFString.of("'"));
  dFeet.set(PDFName.of('C'), PDFNumber.of(1));
  dFeet.set(PDFName.of('F'), PDFName.of('F'));
  dFeet.set(PDFName.of('D'), PDFNumber.of(16));
  dFeet.set(PDFName.of('FD'), context.obj(true));
  dFeet.set(PDFName.of('SS'), PDFString.of('-'));
  const dInch = context.obj({}) as PDFDict;
  dInch.set(PDFName.of('Type'), PDFName.of('NumberFormat'));
  dInch.set(PDFName.of('U'), PDFString.of('"'));
  dInch.set(PDFName.of('C'), PDFNumber.of(12));
  dInch.set(PDFName.of('F'), PDFName.of('F'));
  dInch.set(PDFName.of('D'), PDFNumber.of(16));
  dInch.set(PDFName.of('FD'), context.obj(true));
  const dArr = PDFArray.withContext(context);
  dArr.push(dFeet);
  dArr.push(dInch);
  measure.set(PDFName.of('D'), dArr);
  const measureRef = context.register(measure);

  const viewport = context.obj({}) as PDFDict;
  viewport.set(PDFName.of('Type'), PDFName.of('Viewport'));
  viewport.set(PDFName.of('BBox'), numbers(context, [0, 0, ARCH_D[0], ARCH_D[1]]));
  viewport.set(PDFName.of('Measure'), measureRef);
  viewport.set(PDFName.of('NM'), nm(context, 'EXISTINGVIEWPORTA'.slice(0, 16)));
  const vp = PDFArray.withContext(context);
  vp.push(context.register(viewport));
  page.node.set(PDFName.of('VP'), context.register(vp));

  // A layer.
  const ocg = context.obj({}) as PDFDict;
  ocg.set(PDFName.of('Type'), PDFName.of('OCG'));
  ocg.set(PDFName.of('Name'), PDFString.of('Takeoff'));
  const ocgRef = context.register(ocg);

  const annots = PDFArray.withContext(context);

  // Group parent: a Bluebeam-style length with custom column data and rich text.
  const parent = context.obj({}) as PDFDict;
  parent.set(PDFName.of('Type'), PDFName.of('Annot'));
  parent.set(PDFName.of('Subtype'), PDFName.of('Line'));
  parent.set(PDFName.of('IT'), PDFName.of('LineDimension'));
  parent.set(PDFName.of('L'), numbers(context, [200, 500, 920, 500]));
  parent.set(PDFName.of('Rect'), numbers(context, [190, 480, 930, 530]));
  parent.set(PDFName.of('NM'), nm(context, 'PARENTGROUPLINEAA'.slice(0, 16)));
  parent.set(PDFName.of('T'), PDFString.of('mhackett'));
  parent.set(PDFName.of('Subj'), PDFString.of('Ext Wall'));
  parent.set(PDFName.of('Contents'), PDFString.of('80\'-0"'));
  parent.set(
    PDFName.of('RC'),
    PDFString.of(
      '<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" xfa:APIVersion="BluebeamPDFRevu:2018">80\'-0"</body>',
    ),
  );
  parent.set(PDFName.of('DS'), PDFString.of('font: Helvetica 12pt; color:#FF0000'));
  parent.set(PDFName.of('F'), PDFNumber.of(4));
  parent.set(PDFName.of('C'), numbers(context, [1, 0, 0]));
  parent.set(PDFName.of('CA'), PDFNumber.of(1));
  parent.set(PDFName.of('Cap'), context.obj(true));
  parent.set(PDFName.of('LL'), PDFNumber.of(-10));
  parent.set(PDFName.of('LLE'), PDFNumber.of(2));
  const le = PDFArray.withContext(context);
  le.push(PDFName.of('Slash'));
  le.push(PDFName.of('Slash'));
  parent.set(PDFName.of('LE'), le);
  parent.set(PDFName.of('Measure'), measureRef);
  parent.set(PDFName.of('MeasurementTypes'), PDFNumber.of(130));
  parent.set(PDFName.of('CreationDate'), PDFString.of("D:20260805134807-05'00'"));
  parent.set(PDFName.of('M'), PDFString.of("D:20260805134807-05'00'"));
  const columnData = PDFArray.withContext(context);
  columnData.push(PDFString.of('06-1100'));
  columnData.push(PDFString.of('Framing'));
  parent.set(PDFName.of('BSIColumnData'), columnData);
  parent.set(PDFName.of('OC'), ocgRef);
  parent.set(PDFName.of('P'), page.ref);
  const parentRef = context.register(parent);
  annots.push(parentRef);

  // Group child pointing at the parent.
  const child = context.obj({}) as PDFDict;
  child.set(PDFName.of('Type'), PDFName.of('Annot'));
  child.set(PDFName.of('Subtype'), PDFName.of('Square'));
  child.set(PDFName.of('Rect'), numbers(context, [300, 600, 500, 700]));
  child.set(PDFName.of('NM'), nm(context, 'CHILDOFGROUPBBBB'.slice(0, 16)));
  child.set(PDFName.of('T'), PDFString.of('mhackett'));
  child.set(PDFName.of('Subj'), PDFString.of('Rectangle'));
  child.set(PDFName.of('F'), PDFNumber.of(4));
  child.set(PDFName.of('C'), numbers(context, [0, 0, 1]));
  child.set(PDFName.of('CA'), PDFNumber.of(1));
  child.set(PDFName.of('RT'), PDFName.of('Group'));
  child.set(PDFName.of('IRT'), parentRef);
  child.set(PDFName.of('GroupNesting'), PDFNumber.of(1));
  child.set(PDFName.of('BSIColumnData'), columnData);
  child.set(PDFName.of('CreationDate'), PDFString.of("D:20260805134900-05'00'"));
  child.set(PDFName.of('M'), PDFString.of("D:20260805134900-05'00'"));
  child.set(PDFName.of('P'), page.ref);
  annots.push(context.register(child));

  // A reply to the parent.
  const reply = context.obj({}) as PDFDict;
  reply.set(PDFName.of('Type'), PDFName.of('Annot'));
  reply.set(PDFName.of('Subtype'), PDFName.of('Text'));
  reply.set(PDFName.of('Rect'), numbers(context, [200, 500, 220, 520]));
  reply.set(PDFName.of('NM'), nm(context, 'REPLYTOPARENTCCC'.slice(0, 16)));
  reply.set(PDFName.of('T'), PDFString.of('aaron'));
  reply.set(PDFName.of('Contents'), PDFString.of('Check this against the addendum.'));
  reply.set(PDFName.of('RT'), PDFName.of('R'));
  reply.set(PDFName.of('IRT'), parentRef);
  reply.set(PDFName.of('F'), PDFNumber.of(4));
  reply.set(PDFName.of('P'), page.ref);
  annots.push(context.register(reply));

  page.node.set(PDFName.of('Annots'), context.register(annots));
  return doc.save({ useObjectStreams: false });
}
