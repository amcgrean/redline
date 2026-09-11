/**
 * Properties of the selected markup, editable: subject, stroke, fill, line width, opacity.
 * Each change is one undoable command. A count symbol's subject can be applied to its
 * whole group (the default), since the group is the quantity.
 */

import { useEffect, useState } from 'react';
import { canRegenerateAppearance, countGroupOf } from '@redline/pdf-core';
import { actions, useEditor } from '../store';

import { fromHex, toHex } from '../color';

export function PropertiesPanel() {
  const { doc, selectedId, version } = useEditor();
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
  const targets = () => (group && applyToGroup && groupIds ? groupIds : [markup.id]);

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
        onClick={() => actions.deleteMarkups(group && applyToGroup ? groupIds : [markup.id])}
        title="Delete (Del)"
      >
        {group && applyToGroup && groupIds && groupIds.length > 1
          ? `Delete all ${groupIds.length} in this count`
          : 'Delete markup'}
      </button>
    </div>
  );
}
