/**
 * Profile (PLAN §3.8): the author name written to `/T`, default units and precision,
 * default line style. Saved to IndexedDB; export/import as `*.profile.json`.
 */

import { useRef, useState, type FormEvent } from 'react';
import type { Profile } from '@redline/toolchest';
import { actions } from './store';

export function ProfileDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [author, setAuthor] = useState(profile.author);
  const [display, setDisplay] = useState(profile.units.display);
  const [precision, setPrecision] = useState(String(profile.units.precision));
  const [stroke, setStroke] = useState(profile.defaultStyle.stroke);
  const [lineWidth, setLineWidth] = useState(String(profile.defaultStyle.lineWidth));
  const fileInput = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    actions.updateProfile({
      author: author.trim(),
      units: { display, precision: display === 'ft-in' ? Number(precision) : 2 },
      defaultStyle: {
        ...profile.defaultStyle,
        stroke,
        lineWidth: Math.max(0.25, Number(lineWidth) || 2),
      },
    });
    onClose();
  };

  return (
    <div className="dialog" onClick={onClose}>
      <form
        role="dialog"
        aria-label="Profile"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
      >
        <strong>Profile</strong>
        <label>
          Your name (written as the author of every markup)
          <input
            autoFocus
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="First Last"
            aria-label="Author name"
          />
        </label>
        <label>
          Default display units
          <select
            value={display}
            onChange={(e) => setDisplay(e.target.value as Profile['units']['display'])}
            aria-label="Default display units"
          >
            <option value="ft-in">Feet-inches (80'-0")</option>
            <option value="decimal-ft">Decimal feet (80.00')</option>
          </select>
        </label>
        {display === 'ft-in' && (
          <label>
            Default precision
            <select
              value={precision}
              onChange={(e) => setPrecision(e.target.value)}
              aria-label="Default precision"
            >
              {[1, 2, 4, 8, 16, 32, 64].map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? 'whole inch' : `1/${d}"`}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="row">
          <label>
            Default line colour
            <input
              type="color"
              value={stroke}
              onChange={(e) => setStroke(e.target.value)}
              aria-label="Default line colour"
            />
          </label>
          <label>
            Line width (pt)
            <input
              type="number"
              min={0.25}
              step={0.25}
              value={lineWidth}
              onChange={(e) => setLineWidth(e.target.value)}
              aria-label="Default line width"
            />
          </label>
        </div>
        <div className="row">
          <button
            type="button"
            onClick={() => actions.exportProfile()}
            title="Download *.profile.json"
          >
            Export…
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            title="Load a *.profile.json"
          >
            Import…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            aria-label="Import profile"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                await actions.importProfile(await file.text());
                onClose();
              }
              e.target.value = '';
            }}
          />
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}
