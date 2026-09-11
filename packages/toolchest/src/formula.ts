/**
 * Formula evaluator (PLAN §3.8 "sizing capabilities"): a tiny safe expression language
 * for tool formulas such as `length * height` or `ceil(length * 12 / studSpacing) + 1`.
 * Numbers, `+ - * /`, parentheses, unary minus, `ceil floor round abs sqrt min max`, and
 * identifiers that resolve against a scope (attribute values plus the markup's measured
 * quantities). No `eval`, no property access, no strings.
 */

export type Scope = Readonly<Record<string, number | undefined>>;

type Token =
  { kind: 'num'; value: number } | { kind: 'id'; name: string } | { kind: 'op'; value: string };

/**
 * Measured lengths carry float noise (a 20 ft run reads 20.0000002), which would push
 * `ceil(length * 12 / 16)` from 15 to 16 studs. ceil/floor first snap values that sit
 * within a millionth of an integer.
 */
const EPS = 1e-6;
function snapInteger(v: number): number {
  const nearest = Math.round(v);
  return Math.abs(v - nearest) <= Math.max(1e-9, Math.abs(v) * EPS) ? nearest : v;
}

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  ceil: (v: number) => Math.ceil(snapInteger(v)),
  floor: (v: number) => Math.floor(snapInteger(v)),
  round: (v: number, places = 0) => {
    const f = 10 ** places;
    return Math.round(v * f) / f;
  },
  abs: Math.abs,
  sqrt: Math.sqrt,
  min: Math.min,
  max: Math.max,
};

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\./i.exec(source.slice(i));
      if (!m) throw new Error(`Bad number at ${i}`);
      tokens.push({ kind: 'num', value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!;
      tokens.push({ kind: 'id', name: m[0] });
      i += m[0].length;
      continue;
    }
    if ('+-*/(),'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected "${ch}" in formula`);
  }
  return tokens;
}

/** Parse and evaluate in one pass (formulas are a few tokens long). */
export function evaluateFormula(source: string, scope: Scope): number {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const isOp = (v: string): boolean => {
    const t = peek();
    return t?.kind === 'op' && t.value === v;
  };
  const expect = (v: string): void => {
    if (!isOp(v)) throw new Error(`Expected "${v}" in formula`);
    pos += 1;
  };

  const primary = (): number => {
    const t = peek();
    if (!t) throw new Error('Formula ended early');
    if (t.kind === 'num') {
      pos += 1;
      return t.value;
    }
    if (t.kind === 'op' && t.value === '(') {
      pos += 1;
      const v = additive();
      expect(')');
      return v;
    }
    if (t.kind === 'op' && t.value === '-') {
      pos += 1;
      return -unary();
    }
    if (t.kind === 'op' && t.value === '+') {
      pos += 1;
      return unary();
    }
    if (t.kind === 'id') {
      pos += 1;
      if (isOp('(')) {
        const fn = FUNCTIONS[t.name];
        if (!fn) throw new Error(`Unknown function "${t.name}"`);
        pos += 1;
        const args: number[] = [];
        if (!isOp(')')) {
          args.push(additive());
          while (isOp(',')) {
            pos += 1;
            args.push(additive());
          }
        }
        expect(')');
        return fn(...args);
      }
      const value = scope[t.name];
      if (value === undefined || Number.isNaN(value)) {
        throw new Error(`"${t.name}" has no value`);
      }
      return value;
    }
    throw new Error(`Unexpected "${t.value}" in formula`);
  };
  const unary = (): number => primary();
  const multiplicative = (): number => {
    let v = unary();
    while (isOp('*') || isOp('/')) {
      const op = (peek() as { value: string }).value;
      pos += 1;
      const r = unary();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const additive = (): number => {
    let v = multiplicative();
    while (isOp('+') || isOp('-')) {
      const op = (peek() as { value: string }).value;
      pos += 1;
      const r = multiplicative();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };

  const result = additive();
  if (pos !== tokens.length) throw new Error('Unexpected trailing input in formula');
  if (!Number.isFinite(result)) throw new Error('Formula did not produce a number');
  return result;
}

/** Identifiers a formula reads (functions excluded), for validation and dependency hints. */
export function formulaIdentifiers(source: string): string[] {
  const out = new Set<string>();
  const tokens = tokenize(source);
  tokens.forEach((t, i) => {
    if (t.kind !== 'id') return;
    const next = tokens[i + 1];
    if (next?.kind === 'op' && next.value === '(') return;
    out.add(t.name);
  });
  return [...out];
}

/** Throws with a readable message when a formula cannot be parsed. Values are irrelevant. */
export function validateFormula(source: string): void {
  const scope = new Proxy({}, { get: () => 1 }) as Scope;
  evaluateFormula(source, scope);
}

/** Quantities every formula can use, from a markup's computed measurement. */
export const BUILTIN_QUANTITIES = ['length', 'area', 'perimeter', 'count'] as const;
