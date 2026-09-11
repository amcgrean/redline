import { describe, expect, it } from 'vitest';
import {
  defaultProfile,
  parseProfile,
  serializeProfile,
  PROFILE_SCHEMA_URL,
} from '../src/index.js';

describe('profile schema', () => {
  it('fills defaults for a minimal profile', () => {
    const p = parseProfile({ version: 1, id: 'P1' });
    expect(p.name).toBe('Default');
    expect(p.author).toBe('');
    expect(p.units).toEqual({ display: 'ft-in', precision: 16 });
    expect(p.defaultStyle).toEqual({ stroke: '#d32f2f', lineWidth: 2, fontSize: 10 });
    expect(p.shortcuts).toBe('default');
  });

  it('round-trips through JSON and keeps unknown keys', () => {
    const p = parseProfile({
      version: 1,
      id: 'P2',
      author: 'Pat Estimator',
      units: { display: 'decimal-ft', precision: 2 },
      theme: 'dark',
      updatedAt: '2026-09-10T12:00:00Z',
    });
    const text = serializeProfile(p);
    expect(text.startsWith(`{\n  "$schema": "${PROFILE_SCHEMA_URL}"`)).toBe(true);
    const back = parseProfile(text);
    expect(back.author).toBe('Pat Estimator');
    expect(back.units.display).toBe('decimal-ft');
    expect((back as Record<string, unknown>).theme).toBe('dark');
  });

  it('rejects a wrong version and a bad colour', () => {
    expect(() => parseProfile({ version: 2, id: 'x' })).toThrow();
    expect(() => parseProfile({ version: 1, id: 'x', defaultStyle: { stroke: 'red' } })).toThrow();
  });

  it('defaultProfile carries the author', () => {
    expect(defaultProfile('ID', 'Aaron').author).toBe('Aaron');
  });
});
