/**
 * Markups List: every markup with subject, page, type, value, author and date, grouped by
 * subject with subtotals — the estimator's quantity view. Sortable columns, a text filter,
 * a this-page filter, CSV/XLSX export. Click a row to select the markup and go to its page.
 */

import { useMemo, useState } from 'react';
import type { Markup } from '@redline/pdf-core';
import { countGroupOf, formatArea, formatLength } from '@redline/pdf-core';
import { actions, useEditor } from '../store';
import { downloadMarkupsCsv, downloadMarkupsXlsx } from '../export';
import { formatFormula, formulaColumns, formulaValues } from '../formulas';

interface Row {
  markup: Markup;
  subject: string;
  page: number;
  type: string;
  value: string;
  /** Numeric value for sorting: length, area or 1 for a count. */
  quantity: number;
  author: string;
  modified: string;
  modifiedAt: number;
  formulas: Record<string, number>;
}

interface Group {
  subject: string;
  rows: Row[];
  length: number;
  area: number;
  count: number;
  formulaTotals: Record<string, number>;
}

type SortKey = 'subject' | 'page' | 'type' | 'value' | 'author' | 'modified';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'subject', label: 'Subject' },
  { key: 'page', label: 'Pg' },
  { key: 'type', label: 'Type' },
  { key: 'value', label: 'Value' },
  { key: 'author', label: 'Author' },
];

function typeOf(m: Markup): string {
  if (countGroupOf(m)) return 'Count';
  switch (m.intent) {
    case 'LineDimension':
      return 'Length';
    case 'PolyLineDimension':
      return m.geometry.kind === 'poly' && isClosedRun(m) ? 'Perimeter' : 'Polylength';
    case 'PolygonDimension':
      return 'Area';
    default:
      return m.intent ?? m.rawSubtype;
  }
}

function isClosedRun(m: Markup): boolean {
  if (m.geometry.kind !== 'poly') return false;
  const p = m.geometry.points;
  const a = p[0];
  const b = p[p.length - 1];
  return !!a && !!b && p.length > 2 && a.x === b.x && a.y === b.y;
}

function valueOf(m: Markup): string {
  if (countGroupOf(m)) return '1';
  return m.text?.contents ?? '';
}

function quantityOf(m: Markup): number {
  if (countGroupOf(m)) return 1;
  const c = m.measure?.computed;
  return c?.area ?? c?.length ?? 0;
}

function compare(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case 'page':
      return a.page - b.page;
    case 'value':
      return a.quantity - b.quantity || a.value.localeCompare(b.value);
    case 'modified':
      return a.modifiedAt - b.modifiedAt;
    default:
      return a[key].localeCompare(b[key]);
  }
}

export function MarkupsPanel() {
  const { doc, selectedIds, version, hasDoc, fileName, currentPage, chest } = useEditor();
  const columns = useMemo(() => formulaColumns(chest), [chest]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'subject', dir: 1 });
  const [filter, setFilter] = useState('');
  const [thisPage, setThisPage] = useState(false);
  void version;

  const rows = useMemo((): Row[] => {
    if (!doc) return [];
    return doc.markups.map((m) => ({
      markup: m,
      subject: m.text?.subject || m.rawSubtype,
      page: m.pageIndex + 1,
      type: typeOf(m),
      value: valueOf(m),
      quantity: quantityOf(m),
      author: m.text?.author ?? '',
      modified: m.text?.modified ? m.text.modified.toLocaleDateString() : '',
      modifiedAt: m.text?.modified?.getTime() ?? 0,
      formulas: formulaValues(m, chest),
    }));
  }, [doc, version, chest]);

  const groups = useMemo((): Group[] => {
    const needle = filter.trim().toLowerCase();
    const shown = rows.filter((r) => {
      if (thisPage && r.page !== currentPage + 1) return false;
      if (!needle) return true;
      return [r.subject, r.type, r.value, r.author].some((f) => f.toLowerCase().includes(needle));
    });
    const bySubject = new Map<string, Group>();
    for (const r of shown) {
      let group = bySubject.get(r.subject);
      if (!group) {
        group = { subject: r.subject, rows: [], length: 0, area: 0, count: 0, formulaTotals: {} };
        bySubject.set(r.subject, group);
      }
      group.rows.push(r);
      for (const [k, v] of Object.entries(r.formulas)) {
        group.formulaTotals[k] = (group.formulaTotals[k] ?? 0) + v;
      }
      const c = r.markup.measure?.computed;
      if (countGroupOf(r.markup)) group.count += 1;
      else if (c?.area !== undefined) group.area += c.area;
      else if (c?.length !== undefined) group.length += c.length;
    }
    const list = [...bySubject.values()];
    for (const g of list) g.rows.sort((a, b) => compare(a, b, sort.key) * sort.dir);
    // Groups follow the subject order; other sort keys order rows within each subject.
    list.sort(
      (a, b) => a.subject.localeCompare(b.subject) * (sort.key === 'subject' ? sort.dir : 1),
    );
    return list;
  }, [rows, filter, thisPage, currentPage, sort]);

  if (!hasDoc || !doc)
    return <div className="panel-empty">Open a document to list its markups.</div>;
  if (rows.length === 0) return <div className="panel-empty">No markups yet.</div>;

  const units = doc.pageScales.values().next().value?.units ?? { display: 'ft-in', precision: 16 };
  const shownCount = groups.reduce((n, g) => n + g.rows.length, 0);

  const subtotal = (g: Group): string => {
    const parts: string[] = [];
    if (g.length) parts.push(formatLength(g.length, units, 'ft'));
    if (g.area) parts.push(formatArea(g.area, units, 'ft'));
    if (g.count) parts.push(`${g.count} ea`);
    return parts.join(' · ');
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  return (
    <div className="markups-panel">
      <div className="markups-toolbar">
        <span className="muted small">
          {shownCount === rows.length
            ? `${rows.length} markups · ${groups.length} subjects`
            : `${shownCount} of ${rows.length} markups shown`}
        </span>
        <span>
          <button
            type="button"
            onClick={() => downloadMarkupsCsv(doc, fileName ?? 'markups', chest)}
            title="One row per markup plus a subtotal per subject"
          >
            Export CSV
          </button>{' '}
          <button
            type="button"
            onClick={() => downloadMarkupsXlsx(doc, fileName ?? 'markups', chest)}
            title="Excel workbook: a Markups sheet and a Subtotals sheet"
          >
            Export XLSX
          </button>
        </span>
      </div>
      <div className="markups-filter">
        <input
          type="search"
          placeholder="Filter subject, type, value, author"
          aria-label="Filter markups"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={thisPage}
            onChange={(e) => setThisPage(e.target.checked)}
          />{' '}
          This page
        </label>
      </div>
      <table className="markups" data-testid="markups-list">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                aria-sort={
                  sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'
                }
              >
                <button
                  type="button"
                  onClick={() => toggleSort(c.key)}
                  title={`Sort by ${c.label}`}
                >
                  {c.label}
                  {sort.key === c.key && (
                    <span className="sort-arrow">{sort.dir === 1 ? '▲' : '▼'}</span>
                  )}
                </button>
              </th>
            ))}
            {columns.map((c) => (
              <th key={c.key} className="formula-col" title="Tool formula">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        {groups.length === 0 && (
          <tbody>
            <tr>
              <td colSpan={5 + columns.length} className="muted">
                No markups match.
              </td>
            </tr>
          </tbody>
        )}
        {groups.map((g) => (
          <tbody key={g.subject} data-subject={g.subject}>
            <tr className="group">
              <td colSpan={3}>
                {g.subject} <span className="muted">({g.rows.length})</span>
              </td>
              <td colSpan={2} className="subtotal" data-testid="subtotal">
                {subtotal(g)}
              </td>
              {columns.map((c) => (
                <td key={c.key} className="subtotal formula-col" data-formula={c.key}>
                  {formatFormula(g.formulaTotals[c.key])}
                </td>
              ))}
            </tr>
            {g.rows.map((r) => (
              <tr
                key={r.markup.id}
                className={selectedIds.includes(r.markup.id) ? 'selected' : ''}
                onClick={(e) => {
                  actions.goToPage(r.markup.pageIndex);
                  if (e.shiftKey || e.ctrlKey) actions.toggleSelect(r.markup.id);
                  else actions.select(r.markup.id);
                }}
                title={`/NM ${r.markup.id}`}
              >
                <td className="muted">{r.subject}</td>
                <td>{r.page}</td>
                <td>{r.type}</td>
                <td>{r.value}</td>
                <td className="muted">{r.author}</td>
                {columns.map((c) => (
                  <td key={c.key} className="formula-col" data-formula={c.key}>
                    {formatFormula(r.formulas[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
