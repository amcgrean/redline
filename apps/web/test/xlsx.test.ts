import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildXlsx, columnName } from '../src/xlsx';

describe('columnName', () => {
  it('counts A..Z, AA..', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
});

describe('buildXlsx', () => {
  it('writes a valid package with inline strings, numbers and a bold header', () => {
    const bytes = buildXlsx([
      {
        name: 'Markups',
        rows: [
          ['Subject', 'Length (ft)'],
          ['Wall <A> & "B"', 12.5],
          ['Blank', ''],
        ],
      },
      { name: 'Sub/totals: really long sheet name over limit', rows: [['x', 1]] },
    ]);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    const sheet1 = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet1).toContain(
      '<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Subject</t></is></c>',
    );
    expect(sheet1).toContain('<c r="B2"><v>12.5</v></c>');
    expect(sheet1).toContain('Wall &lt;A&gt; &amp; &quot;B&quot;');
    // Empty cells are omitted rather than written as empty strings.
    expect(sheet1).toContain(
      '<row r="3"><c r="A3" t="inlineStr"><is><t xml:space="preserve">Blank</t></is></c></row>',
    );
    const workbook = strFromU8(files['xl/workbook.xml']!);
    expect(workbook).toContain('<sheet name="Markups" sheetId="1" r:id="rId1"/>');
    expect(workbook).toContain('name="Sub totals  really long sheet n"');
  });
});
