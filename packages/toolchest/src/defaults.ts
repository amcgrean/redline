/**
 * The chest a fresh install starts with. Opinionated defaults from PLAN §3.11 (red 2 pt
 * lines, ft-in to 1/16, Helvetica 10), one tool per v1 measurement kind, quick slots 1–6.
 */

import { ToolChestSchema, type ToolChest, type ToolInput } from './schema.js';

/** Crockford-base32-ish 26-char id; enough for app-level ids without a ULID dependency. */
export function newId(now: Date = new Date()): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = now.getTime();
  let head = '';
  for (let i = 0; i < 10; i += 1) {
    head = alphabet[time % 32] + head;
    time = Math.floor(time / 32);
  }
  let tail = '';
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  for (const b of bytes) tail += alphabet[b % 32];
  return head + tail;
}

const RED = '#d32f2f';
const BLUE = '#1565c0';
const GREEN = '#2e7d32';
const ORANGE = '#ef6c00';

export function defaultTools(): ToolInput[] {
  return [
    {
      id: newId(),
      name: 'Length',
      subject: 'Length',
      kind: 'length',
      style: { stroke: RED, lineWidth: 2, lineEnds: ['ClosedArrow', 'ClosedArrow'] },
      hotkey: '1',
    },
    {
      id: newId(),
      name: 'Polylength',
      subject: 'Polylength',
      kind: 'polylength',
      style: { stroke: RED, lineWidth: 2 },
      hotkey: '2',
    },
    {
      id: newId(),
      name: 'Area',
      subject: 'Area',
      kind: 'area',
      style: { stroke: BLUE, fill: BLUE, fillOpacity: 0.25, lineWidth: 1 },
      hotkey: '3',
    },
    {
      id: newId(),
      name: 'Perimeter',
      subject: 'Perimeter',
      kind: 'perimeter',
      style: { stroke: GREEN, lineWidth: 2, dash: [8, 4] },
      hotkey: '4',
    },
    {
      id: newId(),
      name: 'Rect Area',
      subject: 'Area',
      kind: 'rectarea',
      style: { stroke: BLUE, fill: BLUE, fillOpacity: 0.25, lineWidth: 1 },
      hotkey: '5',
    },
    {
      id: newId(),
      name: 'Count',
      subject: 'Count',
      kind: 'count',
      style: { stroke: ORANGE, fill: ORANGE, fillOpacity: 0.6, lineWidth: 1 },
      hotkey: '6',
    },
  ];
}

export function defaultToolChest(author?: string): ToolChest {
  return ToolChestSchema.parse({
    version: 1,
    id: newId(),
    name: 'Default',
    ...(author && { author }),
    updatedAt: new Date().toISOString(),
    tools: defaultTools(),
  });
}
