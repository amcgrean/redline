/**
 * Edit a tool's attributes (inputs every markup made with it carries) and formulas
 * (columns computed from those inputs and the measured length/area/count).
 */

import { useState } from 'react';
import {
  validateFormula,
  type Tool,
  type ToolAttribute,
  type ToolFormula,
} from '@redline/toolchest';
import { actions } from '../store';

const TYPES: ToolAttribute['type'][] = ['number', 'text', 'boolean'];

function keyOk(key: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key);
}

export function ToolAttributesDialog({ tool, onClose }: { tool: Tool; onClose: () => void }) {
  const [attributes, setAttributes] = useState<ToolAttribute[]>(tool.attributes);
  const [formulas, setFormulas] = useState<ToolFormula[]>(tool.formulas);

  const errors: string[] = [];
  for (const a of attributes)
    if (!keyOk(a.key)) errors.push(`Attribute key "${a.key}" must be a word`);
  for (const f of formulas) {
    if (!keyOk(f.key)) errors.push(`Formula key "${f.key}" must be a word`);
    try {
      validateFormula(f.expr);
    } catch (error) {
      errors.push(`${f.key || 'formula'}: ${(error as Error).message}`);
    }
  }

  const save = () => {
    if (errors.length) return;
    actions.updateTool(tool.id, { attributes, formulas });
    onClose();
  };

  return (
    <div className="dialog" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Attributes of ${tool.name}`}
        className="attrs-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <strong>{tool.name}: attributes and formulas</strong>
        <p className="muted small">
          Attributes are values each markup carries (editable in Properties). Formulas can use them
          plus <code>length</code>, <code>area</code>, <code>perimeter</code>, <code>count</code>{' '}
          and <code>ceil floor round abs sqrt min max</code>.
        </p>

        <h4>Attributes</h4>
        <table className="attrs-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Label</th>
              <th>Type</th>
              <th>Unit</th>
              <th>Default</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {attributes.map((a, i) => (
              <tr key={i}>
                <td>
                  <input
                    value={a.key}
                    aria-label={`Attribute ${i + 1} key`}
                    onChange={(e) =>
                      setAttributes(
                        attributes.map((x, k) => (k === i ? { ...x, key: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={a.label}
                    aria-label={`Attribute ${i + 1} label`}
                    onChange={(e) =>
                      setAttributes(
                        attributes.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  <select
                    value={a.type}
                    aria-label={`Attribute ${i + 1} type`}
                    onChange={(e) =>
                      setAttributes(
                        attributes.map((x, k) =>
                          k === i ? { ...x, type: e.target.value as ToolAttribute['type'] } : x,
                        ),
                      )
                    }
                  >
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={a.unit ?? ''}
                    aria-label={`Attribute ${i + 1} unit`}
                    onChange={(e) =>
                      setAttributes(
                        attributes.map((x, k) => (k === i ? { ...x, unit: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={a.default === undefined ? '' : String(a.default)}
                    aria-label={`Attribute ${i + 1} default`}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const value =
                        a.type === 'number'
                          ? raw === '' || Number.isNaN(Number(raw))
                            ? undefined
                            : Number(raw)
                          : a.type === 'boolean'
                            ? raw === 'true'
                            : raw;
                      setAttributes(
                        attributes.map((x, k) => (k === i ? { ...x, default: value } : x)),
                      );
                    }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="linklike"
                    aria-label={`Remove attribute ${i + 1}`}
                    onClick={() => setAttributes(attributes.filter((_, k) => k !== i))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={() =>
            setAttributes([...attributes, { key: '', label: '', type: 'number', default: 0 }])
          }
        >
          + Attribute
        </button>

        <h4>Formulas</h4>
        <table className="attrs-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Column label</th>
              <th>Expression</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {formulas.map((f, i) => (
              <tr key={i}>
                <td>
                  <input
                    value={f.key}
                    aria-label={`Formula ${i + 1} key`}
                    onChange={(e) =>
                      setFormulas(
                        formulas.map((x, k) => (k === i ? { ...x, key: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={f.label}
                    aria-label={`Formula ${i + 1} label`}
                    onChange={(e) =>
                      setFormulas(
                        formulas.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={f.expr}
                    aria-label={`Formula ${i + 1} expression`}
                    onChange={(e) =>
                      setFormulas(
                        formulas.map((x, k) => (k === i ? { ...x, expr: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="linklike"
                    aria-label={`Remove formula ${i + 1}`}
                    onClick={() => setFormulas(formulas.filter((_, k) => k !== i))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={() => setFormulas([...formulas, { key: '', label: '', expr: 'length' }])}
        >
          + Formula
        </button>

        {errors.length > 0 && (
          <ul className="attrs-errors" role="alert">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        <div className="row">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={errors.length > 0}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
