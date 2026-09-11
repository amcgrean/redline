/**
 * Tool chest and profile schemas. PLAN §3.8 + Appendix C, `*.toolchest.json` version 1.
 *
 * Forward-compatible: unknown keys pass through (`.passthrough()`), so a chest written by a
 * newer Redline still loads, and nothing a user typed into a JSON file is silently dropped.
 */

import { z } from 'zod';

/** `#rrggbb`. */
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');

export const LineEndingSchema = z.enum([
  'None',
  'Square',
  'Circle',
  'Diamond',
  'OpenArrow',
  'ClosedArrow',
  'Butt',
  'ROpenArrow',
  'RClosedArrow',
  'Slash',
]);

/** What a tool draws. The v1 measurement family plus count. */
export const ToolKindSchema = z.enum([
  'length',
  'polylength',
  'area',
  'perimeter',
  'rectarea',
  'count',
  // Sales / review shapes (PLAN §3.10)
  'rectangle',
  'ellipse',
  'line',
  'arrow',
  'polygon',
  'pen',
]);
export type ToolKind = z.infer<typeof ToolKindSchema>;

export const ToolStyleSchema = z
  .object({
    stroke: HexColor,
    fill: HexColor.optional(),
    /** 0..1 */
    fillOpacity: z.number().min(0).max(1).optional(),
    /** 0..1 */
    opacity: z.number().min(0).max(1).default(1),
    lineWidth: z.number().positive().max(50).default(2),
    lineEnds: z.tuple([LineEndingSchema, LineEndingSchema]).optional(),
    dash: z.array(z.number().nonnegative()).optional(),
    font: z
      .object({
        family: z.string().default('Helvetica'),
        size: z.number().positive().default(10),
      })
      .partial()
      .optional(),
  })
  .passthrough();
export type ToolStyle = z.infer<typeof ToolStyleSchema>;

export const MeasureSettingsSchema = z
  .object({
    display: z.enum(['ft-in', 'decimal-ft', 'in', 'm', 'mm', 'cm']).default('ft-in'),
    precision: z.number().positive().default(16),
    caption: z.boolean().default(true),
    captionPosition: z.enum(['top', 'inline']).default('top'),
  })
  .passthrough();

export const AttributeSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'attribute keys are identifiers'),
    label: z.string(),
    type: z.enum(['number', 'text', 'choice', 'boolean']).default('number'),
    unit: z.string().optional(),
    options: z.array(z.union([z.string(), z.number()])).optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .passthrough();
export type ToolAttribute = z.infer<typeof AttributeSchema>;

export const FormulaSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    label: z.string(),
    /** Evaluated by the safe expression evaluator (Phase 3); stored verbatim until then. */
    expr: z.string().min(1),
  })
  .passthrough();
export type ToolFormula = z.infer<typeof FormulaSchema>;

export const ToolSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** `/Subj` on every markup the tool creates — the Markups List bucket. */
    subject: z.string().min(1),
    kind: ToolKindSchema,
    /** Properties mode draws with these properties; drawing mode (Phase 6) places a saved drawing. */
    mode: z.enum(['properties', 'drawing']).default('properties'),
    style: ToolStyleSchema,
    measure: MeasureSettingsSchema.default({
      display: 'ft-in',
      precision: 16,
      caption: true,
      captionPosition: 'top',
    }),
    attributes: z.array(AttributeSchema).default([]),
    formulas: z.array(FormulaSchema).default([]),
    /** Quick slot: a single digit 1..9, or any key name. */
    hotkey: z.string().max(16).optional(),
    icon: z.string().default('auto'),
  })
  .passthrough();
export type Tool = z.infer<typeof ToolSchema>;
export type ToolInput = z.input<typeof ToolSchema>;

export const ToolChestSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    id: z.string().min(1),
    name: z.string().min(1),
    author: z.string().optional(),
    updatedAt: z.iso.datetime({ offset: true }).optional(),
    defaultScale: z
      .object({
        pageLength: z.number().positive(),
        pageUnit: z.enum(['in', 'mm']),
        worldLength: z.number().positive(),
        worldUnit: z.enum(['ft', 'in', 'm', 'mm', 'cm', 'yd']),
      })
      .optional(),
    tools: z.array(ToolSchema),
  })
  .passthrough();
export type ToolChest = z.infer<typeof ToolChestSchema>;
export type ToolChestInput = z.input<typeof ToolChestSchema>;

export const TOOLCHEST_SCHEMA_URL = 'https://redline.app/schemas/toolchest-1.json';

/** Parse and validate a chest (from JSON text or an object). Throws a ZodError on failure. */
export function parseToolChest(input: unknown): ToolChest {
  const value = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  return ToolChestSchema.parse(value);
}

/** Serialise a chest for a `*.toolchest.json` file. */
export function serializeToolChest(chest: ToolChest): string {
  return JSON.stringify({ $schema: TOOLCHEST_SCHEMA_URL, ...chest }, null, 2) + '\n';
}
