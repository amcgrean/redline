import { describe, expect, it } from 'vitest';
import { evaluateFormula, formulaIdentifiers, validateFormula } from '../src/formula.js';

describe('evaluateFormula', () => {
  it('does arithmetic with precedence, parentheses and unary minus', () => {
    expect(evaluateFormula('1 + 2 * 3', {})).toBe(7);
    expect(evaluateFormula('(1 + 2) * 3', {})).toBe(9);
    expect(evaluateFormula('-2 * -3 + 10 / 4', {})).toBe(8.5);
    expect(evaluateFormula('2 * 3.5e1', {})).toBe(70);
  });

  it('reads scope values and calls the allowed functions', () => {
    const scope = { length: 24, height: 9, studSpacing: 16 };
    expect(evaluateFormula('length * height', scope)).toBe(216);
    expect(evaluateFormula('ceil(length * 12 / studSpacing) + 1', scope)).toBe(19);
    expect(evaluateFormula('round(length / 7, 2)', scope)).toBe(3.43);
    expect(evaluateFormula('max(min(length, 10), 5) + abs(-1) + sqrt(16)', scope)).toBe(15);
    // Float noise on a measured 20 ft run must not add a stud.
    expect(evaluateFormula('ceil(length * 12 / 16) + 1', { length: 20.0000002 })).toBe(16);
    expect(evaluateFormula('floor(length * 12 / 16)', { length: 19.9999998 })).toBe(15);
    expect(evaluateFormula('ceil(length * 12 / 16)', { length: 20.01 })).toBe(16);
  });

  it('rejects unknown names, functions, and anything that is not arithmetic', () => {
    expect(() => evaluateFormula('length * height', { length: 1 })).toThrow(/has no value/);
    expect(() => evaluateFormula('eval(1)', {})).toThrow(/Unknown function/);
    expect(() => evaluateFormula('a.b', { a: 1 })).toThrow(/Bad number|Unexpected/);
    expect(() => evaluateFormula('1 +', {})).toThrow(/ended early/);
    expect(() => evaluateFormula('1 / 0', {})).toThrow(/not produce a number/);
    expect(() => evaluateFormula('2 3', {})).toThrow(/trailing/);
  });

  it('lists identifiers and validates syntax without values', () => {
    expect(formulaIdentifiers('ceil(length * 12 / studSpacing) + 1 + height')).toEqual([
      'length',
      'studSpacing',
      'height',
    ]);
    expect(() => validateFormula('length * (height')).toThrow();
    expect(() => validateFormula('length * height')).not.toThrow();
  });
});
