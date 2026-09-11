import { describe, expect, it } from 'vitest';
import {
  defaultToolChest,
  newId,
  parseToolChest,
  serializeToolChest,
  TOOLCHEST_SCHEMA_URL,
} from '../src/index.js';

describe('tool chest schema', () => {
  it('parses PLAN Appendix C verbatim', () => {
    const chest = parseToolChest({
      $schema: TOOLCHEST_SCHEMA_URL,
      version: 1,
      id: '01J9Z6Q3K7N4R8S2T5V9W1X3Y5',
      name: 'Beisser Framing Takeoff',
      author: 'Aaron McGrane',
      updatedAt: '2026-09-08T15:15:00Z',
      defaultScale: { pageLength: 1, pageUnit: 'in', worldLength: 8, worldUnit: 'ft' },
      tools: [
        {
          id: '01J9Z6R1',
          name: 'Ext Wall 2x6 · 9 ft',
          subject: 'Ext Wall 2x6',
          kind: 'length',
          mode: 'properties',
          style: {
            stroke: '#D32F2F',
            opacity: 1,
            lineWidth: 2,
            lineEnds: ['ClosedArrow', 'ClosedArrow'],
            font: { family: 'Helvetica', size: 10 },
          },
          measure: { display: 'ft-in', precision: 16, caption: true, captionPosition: 'top' },
          attributes: [
            { key: 'height', label: 'Wall Height', type: 'number', unit: 'ft', default: 9 },
            {
              key: 'studSpacing',
              label: 'Stud Spacing (in)',
              type: 'choice',
              options: [12, 16, 24],
              default: 16,
            },
          ],
          formulas: [
            { key: 'wallSF', label: 'Wall SF', expr: 'length * height' },
            { key: 'studs', label: 'Studs', expr: 'ceil(length * 12 / studSpacing) + 1' },
          ],
          hotkey: '1',
          icon: 'auto',
        },
      ],
    });
    expect(chest.tools[0]?.subject).toBe('Ext Wall 2x6');
    expect(chest.tools[0]?.attributes[1]?.options).toEqual([12, 16, 24]);
  });

  it('fills defaults and keeps unknown keys', () => {
    const chest = parseToolChest({
      version: 1,
      id: 'x',
      name: 'Min',
      tools: [
        {
          id: 't',
          name: 'L',
          subject: 'L',
          kind: 'length',
          style: { stroke: '#ff0000' },
          future: 1,
        },
      ],
    });
    const tool = chest.tools[0]!;
    expect(tool.mode).toBe('properties');
    expect(tool.style.opacity).toBe(1);
    expect(tool.style.lineWidth).toBe(2);
    expect(tool.measure.display).toBe('ft-in');
    expect(tool.measure.precision).toBe(16);
    expect((tool as Record<string, unknown>)['future']).toBe(1);
  });

  it('rejects bad colours, kinds and versions', () => {
    const base = { version: 1, id: 'x', name: 'Bad', tools: [] };
    expect(() => parseToolChest({ ...base, version: 2 })).toThrow();
    expect(() =>
      parseToolChest({
        ...base,
        tools: [{ id: 't', name: 'L', subject: 'L', kind: 'volume', style: { stroke: '#ff0000' } }],
      }),
    ).toThrow();
    expect(() =>
      parseToolChest({
        ...base,
        tools: [{ id: 't', name: 'L', subject: 'L', kind: 'length', style: { stroke: 'red' } }],
      }),
    ).toThrow();
  });

  it('round-trips through serialize/parse', () => {
    const chest = defaultToolChest('Aaron McGrane');
    const text = serializeToolChest(chest);
    expect(text.startsWith('{\n  "$schema": "https://redline.app/schemas/toolchest-1.json"')).toBe(
      true,
    );
    expect(parseToolChest(text)).toEqual({ ...chest, $schema: TOOLCHEST_SCHEMA_URL });
  });

  it('default chest: six tools, quick slots 1–6, unique ids', () => {
    const chest = defaultToolChest();
    expect(chest.tools.map((t) => t.kind)).toEqual([
      'length',
      'polylength',
      'area',
      'perimeter',
      'rectarea',
      'count',
    ]);
    expect(chest.tools.map((t) => t.hotkey)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(new Set(chest.tools.map((t) => t.id)).size).toBe(6);
    expect(newId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
