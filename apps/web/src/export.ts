/**
 * Markups List export (PLAN §4 Phase 3 "export CSV/XLSX"). CSV now; XLSX later.
 *
 * One row per markup plus a subtotal row per subject, so the file drops straight into a
 * spreadsheet or LiveEdge Estimating. Numbers are plain decimals in feet / square feet /
 * each; the formatted caption is included as its own column for humans.
 */

import type { Markup, RedlineDocument } from '@redline/pdf-core';
import { countGroupOf } from '@redline/pdf-core';

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

export function markupRows(doc: RedlineDocument): ExportRow[] {
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
export function markupsCsv(doc: RedlineDocument): string {
  const rows = markupRows(doc);
  const header = [
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
    lines.push(
      [
        subject,
        '',
        'Subtotal',
        '',
        length ? round(length) : '',
        area ? round(area) : '',
        count ? count : '',
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

/** Trigger a browser download of the CSV. */
export function downloadMarkupsCsv(doc: RedlineDocument, fileName: string): void {
  const csv = markupsCsv(doc);
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName.replace(/\.pdf$/i, '')}.markups.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
