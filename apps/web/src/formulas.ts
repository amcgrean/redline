/**
 * Tool formulas on markups (PLAN §3.8 "sizing capabilities"): a markup made with a chest
 * tool carries the tool id in `/RLTool` and its attribute values in `/RLAttrs`; the
 * tool's formulas are evaluated against those values plus the measured quantities and
 * shown as columns in the Markups List and the exports.
 */

import { countGroupOf, type Markup } from '@redline/pdf-core';
import { evaluateFormula, type Tool, type ToolChest } from '@redline/toolchest';

export interface FormulaColumn {
  key: string;
  label: string;
}

/** Every formula key across the chest, first label wins. */
export function formulaColumns(chest: ToolChest | undefined): FormulaColumn[] {
  const out = new Map<string, string>();
  for (const tool of chest?.tools ?? []) {
    for (const f of tool.formulas) if (!out.has(f.key)) out.set(f.key, f.label);
  }
  return [...out.entries()].map(([key, label]) => ({ key, label }));
}

export function toolOf(markup: Markup, chest: ToolChest | undefined): Tool | undefined {
  if (!markup.tool || !chest) return undefined;
  return chest.tools.find((t) => t.id === markup.tool);
}

/** Attribute values with the tool's defaults filled in. */
export function attributeValues(
  markup: Markup,
  tool: Tool | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const a of tool?.attributes ?? []) {
    if (a.default !== undefined) out[a.key] = a.default;
  }
  for (const [k, v] of Object.entries(markup.attrs ?? {})) {
    if (k === 'count' || k === 'group') continue;
    out[k] = v;
  }
  return out;
}

/** The identifiers a formula can read for this markup. */
export function markupScope(
  markup: Markup,
  tool: Tool | undefined,
): Record<string, number | undefined> {
  const c = markup.measure?.computed as
    { length?: number; area?: number; perimeter?: number } | undefined;
  const scope: Record<string, number | undefined> = {
    length: c?.length,
    area: c?.area,
    perimeter: c?.perimeter,
    count: countGroupOf(markup) ? 1 : 0,
  };
  for (const [k, v] of Object.entries(attributeValues(markup, tool))) {
    if (typeof v === 'number') scope[k] = v;
    else if (typeof v === 'boolean') scope[k] = v ? 1 : 0;
    else if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      scope[k] = Number(v);
    }
  }
  return scope;
}

/** Evaluated formula values for a markup; formulas that fail (missing input) are left out. */
export function formulaValues(
  markup: Markup,
  chest: ToolChest | undefined,
): Record<string, number> {
  const tool = toolOf(markup, chest);
  if (!tool || tool.formulas.length === 0) return {};
  const scope = markupScope(markup, tool);
  const out: Record<string, number> = {};
  for (const f of tool.formulas) {
    try {
      out[f.key] = evaluateFormula(f.expr, scope);
    } catch {
      // An input is missing (e.g. no scale yet): the column stays blank.
    }
  }
  return out;
}

export function formatFormula(value: number | undefined): string {
  if (value === undefined) return '';
  return Number.isInteger(value) ? String(value) : (Math.round(value * 100) / 100).toString();
}
