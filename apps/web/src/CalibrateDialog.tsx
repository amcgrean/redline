/**
 * Two-point calibration: the user clicked two points `pointsDistance` apart (in points)
 * and now types the real-world distance. The result is a page-length : world-length
 * Scale expressed as "1 in = N ft" so the /Measure writer gets exact numbers.
 */

import { useState, type FormEvent } from 'react';
import type { PageScale, Scale, UnitFormat, DisplayFormat } from '@redline/pdf-core';
import { formatFeetInches } from '@redline/pdf-core';

interface Props {
  pointsDistance: number;
  current?: PageScale;
  onApply: (scale: Scale, units: UnitFormat) => void;
  onCancel: () => void;
}

/** Parse `80`, `80'`, `80'-6"`, `80' 6 1/2"`, `12.5` (feet) into decimal feet. */
export function parseFeet(text: string): number | undefined {
  const s = text.trim().replace(/\s+/g, ' ');
  if (!s) return undefined;
  const plain = Number(s);
  if (Number.isFinite(plain)) return plain;
  const m = /^(-)?(\d+(?:\.\d+)?)\s*'?\s*-?\s*(?:(\d+)(?:\s+(\d+)\/(\d+))?\s*"?)?$/.exec(s);
  if (!m) return undefined;
  const feet = Number(m[2]);
  const inches = m[3] ? Number(m[3]) : 0;
  const frac = m[4] && m[5] ? Number(m[4]) / Number(m[5]) : 0;
  const value = feet + (inches + frac) / 12;
  return m[1] ? -value : value;
}

export function CalibrateDialog({ pointsDistance, current, onApply, onCancel }: Props) {
  const [distance, setDistance] = useState('');
  const [display, setDisplay] = useState<DisplayFormat>(current?.units.display ?? 'ft-in');
  const [precision, setPrecision] = useState(String(current?.units.precision ?? 16));
  const feet = parseFeet(distance);
  const valid = feet !== undefined && feet > 0 && pointsDistance > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || feet === undefined) return;
    // pointsDistance pt = feet ft  =>  1 in (72 pt) = feet * 72 / pointsDistance ft
    const scale: Scale = {
      pageLength: 1,
      pageUnit: 'in',
      worldLength: (feet * 72) / pointsDistance,
      worldUnit: 'ft',
    };
    const units: UnitFormat = {
      display,
      precision: display === 'ft-in' ? Number(precision) : 2,
    };
    onApply(scale, units);
  };

  const worldPerInch = valid && feet !== undefined ? (feet * 72) / pointsDistance : 0;
  const preview = valid
    ? `1 in = ${worldPerInch.toFixed(3)} ft  (${(1 / worldPerInch).toFixed(4)} in = 1 ft)`
    : '';

  return (
    <div className="dialog" onClick={onCancel}>
      <form
        role="dialog"
        aria-label="Calibrate page scale"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
      >
        <strong>Calibrate page scale</strong>
        <div>
          Clicked distance: {pointsDistance.toFixed(2)} pt
          {current
            ? ` · current: ${formatFeetInches(pointsDistance * (current.scale.worldLength / (current.scale.pageLength * 72)))}`
            : ''}
        </div>
        <label>
          Real distance (feet, e.g. <code>{`24'-6"`}</code> or <code>24.5</code>)
          <input
            autoFocus
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder={`24'-0"`}
          />
        </label>
        <label>
          Display units
          <select value={display} onChange={(e) => setDisplay(e.target.value as DisplayFormat)}>
            <option value="ft-in">Feet-inches (80'-0")</option>
            <option value="decimal-ft">Decimal feet (80.00')</option>
          </select>
        </label>
        {display === 'ft-in' && (
          <label>
            Precision
            <select value={precision} onChange={(e) => setPrecision(e.target.value)}>
              {[1, 2, 4, 8, 16, 32, 64].map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? 'whole inch' : `1/${d}"`}
                </option>
              ))}
            </select>
          </label>
        )}
        <div style={{ color: '#555', minHeight: '1.2em' }}>{preview}</div>
        <div className="row">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!valid}>
            Apply to page
          </button>
        </div>
      </form>
    </div>
  );
}
