/**
 * Stamp library (PLAN §3.9): built-ins, user stamps from PNG/JPEG/SVG/PDF, custom text,
 * "stamp all pages" with a corner. Picking a stamp switches to the Stamp tool.
 */

import { BUILTIN_STAMPS, type StampCorner } from '@redline/pdf-core';
import { actions, useEditorStore } from '../store';

const CORNERS: { id: StampCorner; label: string }[] = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
  { id: 'center', label: 'Centre' },
];

export function StampsSection() {
  const active = useEditorStore((s) => s.activeStamp);
  const tool = useEditorStore((s) => s.tool);
  const userStamps = useEditorStore((s) => s.userStamps);
  const stampText = useEditorStore((s) => s.stampText);
  const corner = useEditorStore((s) => s.stampCorner);
  const hasDoc = useEditorStore((s) => s.hasDoc);
  const isActive = (kind: 'builtin' | 'user', id: string) =>
    tool === 'stamp' && active.kind === kind && active.id === id;

  return (
    <div className="stamps-section">
      <div className="tools-head">
        <strong>Stamps</strong>
        <span className="muted small">S · click the page to place</span>
      </div>
      <div className="stamp-list" role="listbox" aria-label="Stamps">
        {BUILTIN_STAMPS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="option"
            aria-selected={isActive('builtin', s.id)}
            className={`stamp-chip${isActive('builtin', s.id) ? ' active' : ''}`}
            style={{ color: `rgb(${s.color.r * 255}, ${s.color.g * 255}, ${s.color.b * 255})` }}
            disabled={!hasDoc}
            onClick={() => actions.setActiveStamp({ kind: 'builtin', id: s.id })}
          >
            {s.title}
          </button>
        ))}
        {userStamps.map((s) => (
          <span key={s.id} className="stamp-user">
            <button
              type="button"
              role="option"
              aria-selected={isActive('user', s.id)}
              className={`stamp-chip${isActive('user', s.id) ? ' active' : ''}`}
              disabled={!hasDoc}
              onClick={() => actions.setActiveStamp({ kind: 'user', id: s.id })}
              title={`${s.kind.toUpperCase()} stamp`}
            >
              {s.name}
            </button>
            <button
              type="button"
              className="stamp-remove"
              aria-label={`Remove stamp ${s.name}`}
              title="Remove from the library"
              onClick={() => void actions.removeUserStamp(s.id)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {active.kind === 'builtin' && active.id === 'custom' && (
        <label className="stamp-text">
          Text
          <input
            value={stampText}
            aria-label="Stamp text"
            onChange={(e) => actions.setStampText(e.target.value)}
            placeholder="HOLD FOR PRICING"
          />
        </label>
      )}
      <div className="tools-foot">
        <button
          type="button"
          aria-label="Import stamp"
          title="Add a PNG, JPEG, SVG or one-page PDF as a stamp"
          onClick={() => {
            // Created on demand so no second PDF-accepting input sits in the DOM.
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.png,.jpg,.jpeg,.svg,.pdf';
            input.onchange = () => {
              const file = input.files?.[0];
              if (file) void actions.importStamp(file);
            };
            input.click();
          }}
        >
          Import…
        </button>
        <select
          value={corner}
          aria-label="Stamp corner"
          onChange={(e) => actions.setStampCorner(e.target.value as StampCorner)}
        >
          {CORNERS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!hasDoc}
          onClick={() => void actions.stampAllPages()}
          title="Place the active stamp on every page at that corner"
        >
          Stamp all pages
        </button>
      </div>
    </div>
  );
}
