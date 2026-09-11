/** `#rrggbb` <-> 0..1 RGB, shared by the panels and the tool chest. */

import type { RGB } from '@redline/pdf-core';

export function toHex(c: RGB | undefined): string {
  if (!c) return '#000000';
  const v = (x: number) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${v(c.r)}${v(c.g)}${v(c.b)}`;
}

export function fromHex(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
