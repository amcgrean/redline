/**
 * Markups List (read-only for now): every markup with subject, page, type, value, author
 * and date, grouped by subject with subtotals — the estimator's quantity view. Click a row
 * to select the markup and go to its page.
 */

import { useMemo } from 'react';
import type { Markup } from '@redline/pdf-core';
import { countGroupOf, formatArea, formatLength } from '@redline/pdf-core';
import { actions, useEditor } from '../store';
import { downloadMarkupsCsv } from '../export';

interface Row {
  markup: Markup;
  subject: string;
  page: number;
  type: string;
  value: string;
  author: string;
  modified: string;
}

interface Group {
  subject: string;
  rows: Row[];
  length: number;
  area: number;
  count: number;
}

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

export function MarkupsPanel() {
  const { doc, selectedId, version, hasDoc, fileName } = useEditor();
  void version;

  const groups = useMemo((): Group[] => {
    if (!doc) return [];
    const bySubject = new Map<string, Group>();
    for (const m of doc.markups) {
      const subject = m.text?.subject || m.rawSubtype;
      let group = bySubject.get(subject);
      if (!group) {
        group = { subject, rows: [], length: 0, area: 0, count: 0 };
        bySubject.set(subject, group);
      }
      group.rows.push({
        markup: m,
        subject,
        page: m.pageIndex + 1,
        type: typeOf(m),
        value: valueOf(m),
        author: m.text?.author ?? '',
        modified: m.text?.modified ? m.text.modified.toLocaleDateString() : '',
      });
      const c = m.measure?.computed;
      if (countGroupOf(m)) group.count += 1;
      else if (c?.area !== undefined) group.area += c.area;
      else if (c?.length !== undefined) group.length += c.length;
    }
    return [...bySubject.values()].sort((a, b) => a.subject.localeCompare(b.subject));
  }, [doc, version]);

  if (!hasDoc || !doc)
    return <div className="panel-empty">Open a document to list its markups.</div>;
  if (groups.length === 0) return <div className="panel-empty">No markups yet.</div>;

  const units = doc.pageScales.values().next().value?.units ?? { display: 'ft-in', precision: 16 };

  const subtotal = (g: Group): string => {
    const parts: string[] = [];
    if (g.length) parts.push(formatLength(g.length, units, 'ft'));
    if (g.area) parts.push(formatArea(g.area, units, 'ft'));
    if (g.count) parts.push(`${g.count} ea`);
    return parts.join(' · ');
  };

  return (
    <div className="markups-panel">
      <div className="markups-toolbar">
        <span className="muted small">
          {doc.markups.length} markups · {groups.length} subjects
        </span>
        <button
          type="button"
          onClick={() => downloadMarkupsCsv(doc, fileName ?? 'markups')}
          title="One row per markup plus a subtotal per subject"
        >
          Export CSV
        </button>
      </div>
      <table className="markups" data-testid="markups-list">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Pg</th>
            <th>Type</th>
            <th>Value</th>
            <th>Author</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.subject} data-subject={g.subject}>
            <tr className="group">
              <td colSpan={3}>
                {g.subject} <span className="muted">({g.rows.length})</span>
              </td>
              <td colSpan={2} className="subtotal" data-testid="subtotal">
                {subtotal(g)}
              </td>
            </tr>
            {g.rows.map((r) => (
              <tr
                key={r.markup.id}
                className={r.markup.id === selectedId ? 'selected' : ''}
                onClick={() => {
                  actions.goToPage(r.markup.pageIndex);
                  actions.select(r.markup.id);
                }}
                title={`/NM ${r.markup.id}`}
              >
                <td className="muted">{r.subject}</td>
                <td>{r.page}</td>
                <td>{r.type}</td>
                <td>{r.value}</td>
                <td className="muted">{r.author}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
