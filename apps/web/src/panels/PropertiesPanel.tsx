/**
 * Properties of the selected markup, editable: subject, stroke, fill, line width, opacity.
 * Each change is one undoable command. A count symbol's subject can be applied to its
 * whole group (the default), since the group is the quantity.
 */

import { useEffect, useState } from 'react';
import type { Markup } from '@redline/pdf-core';
import { canRegenerateAppearance, countGroupOf } from '@redline/pdf-core';
import { actions, useEditor } from '../store';

import { fromHex, toHex } from '../color';
import { useEditorStore } from '../store';
import { attributeValues, formatFormula, formulaValues, toolOf } from '../formulas';

export function PropertiesPanel() {
  const { doc, selectedId, selectedIds, version } = useEditor();
  void version;
  const markup = doc?.markups.find((m) => m.id === selectedId);
  const [subject, setSubject] = useState('');
  const [applyToGroup, setApplyToGroup] = useState(true);

  useEffect(() => {
    setSubject(markup?.text?.subject ?? '');
  }, [markup?.id, markup?.text?.subject]);

  if (!markup || !doc) {
    return <div className="panel-empty">Select a markup to see its properties.</div>;
  }

  const group = countGroupOf(markup);
  const groupIds = group
    ? doc.markups.filter((m) => countGroupOf(m) === group).map((m) => m.id)
    : undefined;
  // A multi-selection is edited as a whole; otherwise a count group, otherwise the one markup.
  const targets = () =>
    selectedIds.length > 1
      ? selectedIds
      : group && applyToGroup && groupIds
        ? groupIds
        : [markup.id];

  const commitSubject = () => {
    const next = subject.trim();
    if (!next || next === markup.text?.subject) return;
    actions.updateProperties({ subject: next }, targets(), 'Change subject');
  };

  const foreign = !canRegenerateAppearance(markup);

  const rows: [string, string | undefined][] = [
    ['Type', `${markup.rawSubtype}${markup.intent ? ` / ${markup.intent}` : ''}`],
    ['Value', group ? `1 of ${groupIds?.length ?? 1} (count)` : markup.text?.contents],
    ['Page', String(markup.pageIndex + 1)],
    ['Author', markup.text?.author],
    ['Created', markup.text?.created?.toLocaleString()],
    ['Modified', markup.text?.modified?.toLocaleString()],
    ['Locked', markup.flags.locked ? 'yes' : 'no'],
    ['ID (/NM)', markup.id],
  ];

  return (
    <div className="properties-panel">
      {selectedIds.length > 1 && (
        <div className="muted small">
          {selectedIds.length} selected — edits and Delete apply to all of them.
        </div>
      )}
      <label className="prop">
        Subject
        <input
          value={subject}
          aria-label="Subject"
          disabled={markup.flags.locked}
          onChange={(e) => setSubject(e.target.value)}
          onBlur={commitSubject}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
      {(markup.rawSubtype === 'FreeText' || markup.rawSubtype === 'Text') && (
        <label className="prop">
          Text
          <textarea
            aria-label="Markup text"
            rows={3}
            defaultValue={markup.text?.contents ?? ''}
            key={`${markup.id}:${markup.text?.contents ?? ''}`}
            disabled={markup.flags.locked}
            onBlur={(e) => actions.setText(markup.id, e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
          />
        </label>
      )}
      {group && groupIds && groupIds.length > 1 && (
        <label className="prop-inline">
          <input
            type="checkbox"
            checked={applyToGroup}
            onChange={(e) => setApplyToGroup(e.target.checked)}
          />
          Apply to all {groupIds.length} in this count
        </label>
      )}
      <AttributesSection markup={markup} targets={targets} />

      <div className="prop-row">
        <label className="prop-inline">
          Stroke
          <input
            type="color"
            aria-label="Stroke colour"
            value={toHex(markup.style.stroke)}
            disabled={markup.flags.locked}
            onChange={(e) =>
              actions.updateProperties(
                { stroke: fromHex(e.target.value) },
                targets(),
                'Change colour',
              )
            }
          />
        </label>
        <label className="prop-inline">
          Fill
          <input
            type="color"
            aria-label="Fill colour"
            value={toHex(markup.style.fill ?? markup.style.stroke)}
            disabled={markup.flags.locked || markup.geometry.kind === 'line'}
            onChange={(e) =>
              actions.updateProperties({ fill: fromHex(e.target.value) }, targets(), 'Change fill')
            }
          />
        </label>
      </div>
      <div className="prop-row">
        <label className="prop-inline">
          Width
          <input
            type="number"
            aria-label="Line width"
            min={0.25}
            max={20}
            step={0.25}
            value={markup.style.width}
            disabled={markup.flags.locked}
            onChange={(e) => {
              const w = Number(e.target.value);
              if (w > 0) actions.updateProperties({ width: w }, targets(), 'Change width');
            }}
          />
          pt
        </label>
        <label className="prop-inline">
          Opacity
          <input
            type="range"
            aria-label="Opacity"
            min={10}
            max={100}
            step={5}
            value={Math.round(markup.style.opacity * 100)}
            disabled={markup.flags.locked}
            onChange={(e) =>
              actions.updateProperties(
                { opacity: Number(e.target.value) / 100 },
                targets(),
                'Change opacity',
              )
            }
          />
          {Math.round(markup.style.opacity * 100)}%
        </label>
      </div>
      {foreign && (
        <div className="muted small">
          Style changes on this markup update its properties; its drawing is redrawn by Revu on the
          next edit there.
        </div>
      )}

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
      <label className="prop-inline">
        <input
          type="checkbox"
          checked={markup.flags.locked}
          onChange={(e) => actions.setLocked(targets(), e.target.checked)}
          aria-label="Locked"
        />
        Locked
      </label>
      <button
        type="button"
        onClick={() => actions.addToolFromMarkup(markup.id)}
        title="Save this markup's subject and style as a tool"
      >
        Add to Tool Chest
      </button>
      <button
        type="button"
        className="danger"
        disabled={markup.flags.locked}
        onClick={() => actions.deleteMarkups(targets())}
        title="Delete (Del)"
      >
        {selectedIds.length > 1
          ? `Delete ${selectedIds.length} markups`
          : group && applyToGroup && groupIds && groupIds.length > 1
            ? `Delete all ${groupIds.length} in this count`
            : 'Delete markup'}
      </button>
    </div>
  );
}

/** The tool's attributes (editable) and formula results (read-only) for one markup. */
function AttributesSection({ markup, targets }: { markup: Markup; targets: () => string[] }) {
  const chest = useEditorStore((s) => s.chest);
  const tool = toolOf(markup, chest);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    setDrafts({});
  }, [markup.id, markup.attrs]);
  if (!tool || (tool.attributes.length === 0 && tool.formulas.length === 0)) return null;
  const values = attributeValues(markup, tool);
  const results = formulaValues(markup, chest);
  const commit = (key: string, type: string, raw: string) => {
    const value =
      type === 'number'
        ? raw.trim() === '' || Number.isNaN(Number(raw))
          ? undefined
          : Number(raw)
        : raw;
    if (value === undefined || value === values[key]) return;
    actions.updateProperties({ attrs: { [key]: value } }, targets(), 'Change attribute');
  };
  return (
    <div className="prop-attrs">
      <div className="muted small">Tool: {tool.name}</div>
      {tool.attributes.map((a) => (
        <label key={a.key} className="prop-inline">
          {a.label}
          {a.unit ? ` (${a.unit})` : ''}
          {a.type === 'boolean' ? (
            <input
              type="checkbox"
              aria-label={a.label}
              checked={values[a.key] === true}
              disabled={markup.flags.locked}
              onChange={(e) =>
                actions.updateProperties(
                  { attrs: { [a.key]: e.target.checked } },
                  targets(),
                  'Change attribute',
                )
              }
            />
          ) : (
            <input
              type={a.type === 'number' ? 'number' : 'text'}
              step="any"
              aria-label={a.label}
              value={drafts[a.key] ?? String(values[a.key] ?? '')}
              disabled={markup.flags.locked}
              onChange={(e) => setDrafts({ ...drafts, [a.key]: e.target.value })}
              onBlur={(e) => commit(a.key, a.type, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(a.key, a.type, (e.target as HTMLInputElement).value);
              }}
            />
          )}
        </label>
      ))}
      {tool.formulas.map((f) => (
        <div key={f.key} className="prop-formula" data-formula={f.key}>
          <span className="muted">{f.label}</span> {formatFormula(results[f.key])}
        </div>
      ))}
    </div>
  );
}
