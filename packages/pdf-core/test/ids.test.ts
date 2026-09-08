import { describe, expect, it } from 'vitest';
import { generateNM, generateUniqueNM, isValidNM } from '../src/ids.js';

describe('/NM generation', () => {
  it('is 16 uppercase letters', () => {
    for (let i = 0; i < 200; i += 1) expect(isValidNM(generateNM())).toBe(true);
  });

  it('uses every letter without modulo bias', () => {
    // Feed bytes 0..255 in order; only 0..233 map to letters, and each letter 9 times.
    let counter = 0;
    const bytes = (n: number) => Uint8Array.from({ length: n }, () => counter++ % 256);
    const seen = new Set<string>();
    for (let i = 0; i < 64; i += 1) for (const ch of generateNM(bytes)) seen.add(ch);
    expect(seen.size).toBe(26);
  });

  it('avoids collisions with taken ids', () => {
    let calls = 0;
    // First call yields all-A, second yields all-B.
    const bytes = (n: number) => {
      const value = calls++ === 0 ? 0 : 1;
      return new Uint8Array(n).fill(value);
    };
    const taken = new Set(['AAAAAAAAAAAAAAAA']);
    expect(generateUniqueNM(taken, bytes)).toBe('BBBBBBBBBBBBBBBB');
    expect(taken.has('BBBBBBBBBBBBBBBB')).toBe(true);
  });

  it('rejects malformed ids', () => {
    expect(isValidNM('abcdefghijklmnop')).toBe(false);
    expect(isValidNM('ABCDEFGHIJKLMNO')).toBe(false);
    expect(isValidNM('ABCDEFGHIJKLMNOP1')).toBe(false);
  });
});
