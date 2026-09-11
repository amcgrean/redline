/**
 * Markups List export (PLAN §4 Phase 3 "export CSV/XLSX"). CSV now; XLSX later.
 *
 * One row per markup plus a subtotal row per subject, so the file drops straight into a
 * spreadsheet or LiveEdge Estimating. Numbers are plain decimals in feet / square feet /
 * each; the formatted caption is included as its own column for humans.
 */

import type { Markup, RedlineDocument } from '@redline/pdf-core';
import { countGroupOf } from '@redline/pdf-core';
import { buildXlsx, type Cell } from './xlsx';
import type { ToolChest } from '@redline/toolchest';
import { formulaColumns, formulaValues } from './formulas';
import { downloadBytes } from './download';

export interface ExportRow {
  subject: string;
  page: number;
  type: string;
  value: string;
  lengthFt: number | '';
  areaSf: number | '';
  count: number | '';
  author: string;
  modified: string;
  id: string;
  /** Formula values keyed by formula key (only when a chest was given). */
  formulas: Record<string, number>;
}

function typeOf(m: Markup): string {
  if (countGroupOf(m)) return 'Count';
  switch (m.intent) {
    case 'LineDimension':
      return 'Length';
    case 'PolyLineDimension':
      return 'Polylength';
    case 'PolygonDimension':
      return 'Area';
    default:
      return m.intent ?? m.rawSubtype;
  }
}

export function markupRows(doc: RedlineDocument, chest?: ToolChest): ExportRow[] {
  return doc.markups.map((m) => {
    const c = m.measure?.computed;
    const isCount = !!countGroupOf(m);
    return {
      subject: m.text?.subject || m.rawSubtype,
      page: m.pageIndex + 1,
      type: typeOf(m),
      value: isCount ? '1' : (m.text?.contents ?? ''),
      lengthFt: !isCount && c?.length !== undefined && c.area === undefined ? round(c.length) : '',
      areaSf: !isCount && c?.area !== undefined ? round(c.area) : '',
      count: isCount ? 1 : '',
      author: m.text?.author ?? '',
      modified: m.text?.modified ? m.text.modified.toISOString() : '',
      id: m.id,
      formulas: chest ? formulaValues(m, chest) : {},
    };
  });
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV with a header, one row per markup, and a `Subtotal` row per subject. */
export function markupsCsv(doc: RedlineDocument, chest?: ToolChest): string {
  const rows = markupRows(doc, chest);
  const columns = formulaColumns(chest);
  const header = [
    'Subject',
    'Page',
    'Type',
    'Value',
    'Length (ft)',
    'Area (sf)',
    'Count',
    ...columns.map((c) => c.label),
    'Author',
    'Modified',
    'ID',
  ];
  const lines: string[] = [header.map(csvCell).join(',')];

  const bySubject = new Map<string, ExportRow[]>();
  for (const r of rows) {
    const list = bySubject.get(r.subject) ?? [];
    list.push(r);
    bySubject.set(r.subject, list);
  }
  for (const subject of [...bySubject.keys()].sort((a, b) => a.localeCompare(b))) {
    const group = bySubject.get(subject)!;
    for (const r of group) {
      lines.push(
        [
          r.subject,
          r.page,
          r.type,
          r.value,
          r.lengthFt,
          r.areaSf,
          r.count,
          ...columns.map((c) => (r.formulas[c.key] === undefined ? '' : round(r.formulas[c.key]!))),
          r.author,
          r.modified,
          r.id,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    const sum = (pick: (r: ExportRow) => number | '') =>
      group.reduce((acc, r) => acc + (pick(r) === '' ? 0 : Number(pick(r))), 0);
    const length = sum((r) => r.lengthFt);
    const area = sum((r) => r.areaSf);
    const count = sum((r) => r.count);
    const formulaTotals = columns.map((c) =>
      group.reduce((acc, r) => acc + (r.formulas[c.key] ?? 0), 0),
    );
    lines.push(
      [
        subject,
        '',
        'Subtotal',
        '',
        length ? round(length) : '',
        area ? round(area) : '',
        count ? count : '',
        ...formulaTotals.map((t) => (t ? round(t) : '')),
        '',
        '',
        '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

const HEADER = [
  'Subject',
  'Page',
  'Type',
  'Value',
  'Length (ft)',
  'Area (sf)',
  'Count',
  'Author',
  'Modified',
  'ID',
];

/** Subtotals per subject: rows, length, area, count. */
export function subjectTotals(
  rows: ExportRow[],
): { subject: string; rows: number; lengthFt: number; areaSf: number; count: number }[] {
  const bySubject = new Map<string, ExportRow[]>();
  for (const r of rows) {
    const list = bySubject.get(r.subject) ?? [];
    list.push(r);
    bySubject.set(r.subject, list);
  }
  const num = (v: number | '') => (v === '' ? 0 : v);
  return [...bySubject.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subject, group]) => ({
      subject,
      rows: group.length,
      lengthFt: round(group.reduce((acc, r) => acc + num(r.lengthFt), 0)),
      areaSf: round(group.reduce((acc, r) => acc + num(r.areaSf), 0)),
      count: group.reduce((acc, r) => acc + num(r.count), 0),
    }));
}

/** Two sheets: every markup, and a subtotal per subject. */
export function markupsXlsx(doc: RedlineDocument, chest?: ToolChest): Uint8Array {
  const rows = markupRows(doc, chest);
  const columns = formulaColumns(chest);
  const markups: Cell[][] = [
    [...HEADER.slice(0, 7), ...columns.map((c) => c.label), ...HEADER.slice(7)],
    ...rows.map((r) => [
      r.subject,
      r.page,
      r.type,
      r.value,
      r.lengthFt,
      r.areaSf,
      r.count,
      ...columns.map((c) => (r.formulas[c.key] === undefined ? '' : round(r.formulas[c.key]!))),
      r.author,
      r.modified,
      r.id,
    ]),
  ];
  const totals: Cell[][] = [
    ['Subject', 'Markups', 'Length (ft)', 'Area (sf)', 'Count', ...columns.map((c) => c.label)],
    ...subjectTotals(rows).map((t) => [
      t.subject,
      t.rows,
      t.lengthFt || '',
      t.areaSf || '',
      t.count || '',
      ...columns.map((c) => {
        const total = rows
          .filter((r) => r.subject === t.subject)
          .reduce((acc, r) => acc + (r.formulas[c.key] ?? 0), 0);
        return total ? round(total) : '';
      }),
    ]),
  ];
  return buildXlsx([
    { name: 'Markups', rows: markups },
    { name: 'Subtotals', rows: totals },
  ]);
}

/** Trigger a browser download of the CSV. */
export function downloadMarkupsCsv(
  doc: RedlineDocument,
  fileName: string,
  chest?: ToolChest,
): void {
  const csv = markupsCsv(doc, chest);
  downloadBytes(
    '\uFEFF' + csv,
    `${fileName.replace(/\.pdf$/i, '')}.markups.csv`,
    'text/csv;charset=utf-8',
  );
}

/** Trigger a browser download of the XLSX. */
export function downloadMarkupsXlsx(
  doc: RedlineDocument,
  fileName: string,
  chest?: ToolChest,
): void {
  const bytes = markupsXlsx(doc, chest);
  downloadBytes(
    bytes,
    `${fileName.replace(/\.pdf$/i, '')}.markups.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}
