/**
 * Properties of the selected markup. Read-only until the style/subject writers land in
 * pdf-core (owned keys /Subj, /C, /IC, /CA, /BS with /AP regeneration).
 */

import { countGroupOf } from '@redline/pdf-core';
import { actions, useEditor } from '../store';

function rgbCss(c: { r: number; g: number; b: number } | undefined): string | undefined {
  if (!c) return undefined;
  const v = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  return `rgb(${v(c.r)}, ${v(c.g)}, ${v(c.b)})`;
}

export function PropertiesPanel() {
  const { doc, selectedId, version } = useEditor();
  void version;
  const markup = doc?.markups.find((m) => m.id === selectedId);
  if (!markup) return <div className="panel-empty">Select a markup to see its properties.</div>;

  const rows: [string, string | undefined][] = [
    ['Type', `${markup.rawSubtype}${markup.intent ? ` / ${markup.intent}` : ''}`],
    ['Subject', markup.text?.subject],
    ['Value', countGroupOf(markup) ? '1 (count symbol)' : markup.text?.contents],
    ['Page', String(markup.pageIndex + 1)],
    ['Author', markup.text?.author],
    ['Created', markup.text?.created?.toLocaleString()],
    ['Modified', markup.text?.modified?.toLocaleString()],
    ['Line width', `${markup.style.width} pt`],
    ['Opacity', `${Math.round(markup.style.opacity * 100)}%`],
    ['Locked', markup.flags.locked ? 'yes' : 'no'],
    ['ID (/NM)', markup.id],
  ];

  return (
    <div className="properties-panel">
      <div className="swatches">
        <span
          className="swatch"
          style={{ background: rgbCss(markup.style.stroke) }}
          title="Stroke"
        />
        {markup.style.fill && (
          <span className="swatch" style={{ background: rgbCss(markup.style.fill) }} title="Fill" />
        )}
      </div>
      <dl>
        {rows.map(([k, v]) =>
          v ? (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ) : null,
        )}
      </dl>
      {markup.attrs && (
        <>
          <h3>Attributes</h3>
          <dl>
            {Object.entries(markup.attrs).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <div className="muted small">Editing properties arrives with the style writers.</div>
      <button
        type="button"
        className="danger"
        disabled={markup.flags.locked}
        onClick={() => actions.deleteMarkups([markup.id])}
        title="Delete (Del)"
      >
        Delete markup
      </button>
    </div>
  );
}
