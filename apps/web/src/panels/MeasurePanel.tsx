/**
 * Measure panel — Revu's Measurements panel, reduced to what estimators use: the current
 * page's scale, calibrate, presets, units/precision, and the scope a scale applies to.
 */

import { useState } from 'react';
import type { DisplayFormat, Scale, UnitFormat } from '@redline/pdf-core';
import { FRACTION_DENOMINATORS, formatFeetInches, worldUnitsPerPoint } from '@redline/pdf-core';
import { actions, useEditor, useEditorStore, type ScaleScope } from '../store';

/** PLAN §3.7 presets: page inches per foot. */
export const PRESETS: { label: string; pageLength: number }[] = [
  { label: '1/16" = 1\'-0"', pageLength: 1 / 16 },
  { label: '3/32" = 1\'-0"', pageLength: 3 / 32 },
  { label: '1/8" = 1\'-0"', pageLength: 1 / 8 },
  { label: '3/16" = 1\'-0"', pageLength: 3 / 16 },
  { label: '1/4" = 1\'-0"', pageLength: 1 / 4 },
  { label: '3/8" = 1\'-0"', pageLength: 3 / 8 },
  { label: '1/2" = 1\'-0"', pageLength: 1 / 2 },
  { label: '3/4" = 1\'-0"', pageLength: 3 / 4 },
  { label: '1" = 1\'-0"', pageLength: 1 },
];

const SCOPES: { id: ScaleScope; label: string }[] = [
  { id: 'page', label: 'This page' },
  { id: 'like', label: 'Pages like this one' },
  { id: 'all', label: 'All pages' },
];

function describe(scale: Scale): string {
  // Express as X" = 1'-0" when it is a clean architectural ratio, else 1 in = N ft.
  const inchesPerFoot =
    (scale.pageLength * (scale.pageUnit === 'in' ? 1 : 1 / 25.4)) / scale.worldLength;
  const preset = PRESETS.find((p) => Math.abs(p.pageLength - inchesPerFoot) < 1e-6);
  if (preset && scale.worldUnit === 'ft') return preset.label;
  const perInch = worldUnitsPerPoint(scale) * 72;
  return `1 in = ${perInch.toFixed(3)} ${scale.worldUnit}`;
}

export function MeasurePanel() {
  const { doc, currentPage, hasDoc } = useEditor();
  const scope = useEditorStore((s) => s.scaleScope);
  const pageScale = doc?.pageScales.get(currentPage);
  const profileUnits = useEditorStore.getState().profile.units;
  const [display, setDisplay] = useState<DisplayFormat>(
    pageScale?.units.display ?? profileUnits.display,
  );
  const [precision, setPrecision] = useState(
    String(pageScale?.units.precision ?? profileUnits.precision),
  );
  const [customFeet, setCustomFeet] = useState('');

  if (!hasDoc || !doc) return <div className="panel-empty">Open a document to set its scale.</div>;

  const units: UnitFormat = {
    display,
    precision: display === 'ft-in' ? Number(precision) : 2,
  };

  const apply = (pageLength: number) => {
    actions.calibrate(
      currentPage,
      { pageLength, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' },
      units,
    );
  };

  const applyCustom = () => {
    const feet = Number(customFeet);
    if (!Number.isFinite(feet) || feet <= 0) return;
    actions.calibrate(
      currentPage,
      { pageLength: 1, pageUnit: 'in', worldLength: feet, worldUnit: 'ft' },
      units,
    );
  };

  const calibratedPages = [...doc.pageScales.keys()].length;

  return (
    <div className="measure-panel">
      <section>
        <h3>Page {currentPage + 1} scale</h3>
        <div className="scale-current" data-testid="scale-current">
          {pageScale ? (
            <>
              <strong>{describe(pageScale.scale)}</strong>
              <span className="muted">
                {' '}
                · {formatFeetInches(worldUnitsPerPoint(pageScale.scale) * 72)} per inch ·{' '}
                {pageScale.fromDocument ? 'from document' : 'calibrated'}
              </span>
            </>
          ) : (
            <span className="muted">Not set</span>
          )}
        </div>
        <div className="muted small">
          {calibratedPages} of {doc.pdfDoc.getPageCount()} pages have a scale
        </div>
      </section>

      <section>
        <h3>Apply to</h3>
        <div className="scope" role="radiogroup" aria-label="Scale scope">
          {SCOPES.map((s) => (
            <label key={s.id}>
              <input
                type="radio"
                name="scale-scope"
                value={s.id}
                checked={scope === s.id}
                onChange={() => actions.setScaleScope(s.id)}
              />
              {s.label}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h3>Units</h3>
        <label>
          Display
          <select
            value={display}
            onChange={(e) => setDisplay(e.target.value as DisplayFormat)}
            aria-label="Display units"
          >
            <option value="ft-in">Feet-inches (80'-0")</option>
            <option value="decimal-ft">Decimal feet (80.00')</option>
          </select>
        </label>
        {display === 'ft-in' && (
          <label>
            Precision
            <select
              value={precision}
              onChange={(e) => setPrecision(e.target.value)}
              aria-label="Precision"
            >
              {FRACTION_DENOMINATORS.map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? 'whole inch' : `1/${d}"`}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section>
        <h3>Calibrate</h3>
        <button type="button" onClick={() => actions.setTool('calibrate')} className="wide">
          Calibrate with two points (X)
        </button>
        <div className="muted small">Click two points a known distance apart, then type it.</div>
      </section>

      <section>
        <h3>Presets</h3>
        <div className="presets">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => apply(p.pageLength)}
              aria-label={`Preset ${p.label}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="custom-scale">
          1 in =
          <input
            value={customFeet}
            onChange={(e) => setCustomFeet(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyCustom();
            }}
            placeholder="ft"
            aria-label="Custom feet per inch"
            inputMode="decimal"
          />
          ft
          <button type="button" onClick={applyCustom} disabled={!(Number(customFeet) > 0)}>
            Apply
          </button>
        </label>
      </section>
    </div>
  );
}
