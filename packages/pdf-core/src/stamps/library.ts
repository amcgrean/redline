/**
 * Built-in text stamps (PLAN §3.9): Approved / Received / Draft / Reviewed / Void plus
 * a free-text one. Lines may carry dynamic fields (`{date}`, `{user}`, …) that
 * `bakeFields` fills at placement.
 */

import type { RGB } from '../types.js';

export interface BuiltinStamp {
  id: string;
  title: string;
  /** First line is the headline; the rest are smaller. */
  lines: string[];
  color: RGB;
}

const GREEN: RGB = { r: 0.13, g: 0.55, b: 0.13 };
const BLUE: RGB = { r: 0.1, g: 0.35, b: 0.75 };
const GRAY: RGB = { r: 0.4, g: 0.4, b: 0.4 };
const ORANGE: RGB = { r: 0.9, g: 0.45, b: 0.05 };
const RED: RGB = { r: 0.8, g: 0.12, b: 0.12 };

export const BUILTIN_STAMPS: readonly BuiltinStamp[] = [
  { id: 'approved', title: 'APPROVED', lines: ['APPROVED', '{user} · {date}'], color: GREEN },
  { id: 'received', title: 'RECEIVED', lines: ['RECEIVED', '{date} {time}'], color: BLUE },
  { id: 'draft', title: 'DRAFT', lines: ['DRAFT'], color: GRAY },
  { id: 'reviewed', title: 'REVIEWED', lines: ['REVIEWED', '{user} · {date}'], color: BLUE },
  { id: 'revised', title: 'REVISED', lines: ['REVISED', '{date}'], color: ORANGE },
  { id: 'void', title: 'VOID', lines: ['VOID'], color: RED },
  { id: 'for-review', title: 'FOR REVIEW', lines: ['FOR REVIEW', '{date}'], color: BLUE },
  { id: 'custom', title: 'Custom text', lines: ['{text}'], color: RED },
];

export function builtinStamp(id: string): BuiltinStamp | undefined {
  return BUILTIN_STAMPS.find((s) => s.id === id);
}
