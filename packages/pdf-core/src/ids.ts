/**
 * Annotation identity. See PLAN §3.6 "Identity and metadata".
 *
 * `/NM` is 16 uppercase A–Z letters, unique per document, assigned once at creation
 * and NEVER regenerated (CLAUDE.md non-negotiable #4) — Revu, Studio, custom-column
 * data and reply chains all key off it. Verified against
 * `fixtures/Takeoff bluebeam copy 16228 Sharon Drive - Urbandale.pdf`, whose Revu-authored
 * annotations carry e.g. `/NM(OOSEGTJJAOULQSTQ)` and whose viewports carry
 * `/NM(BUULQOYKDWTRIJOI)` — so Revu stamps `/NM` on `/Viewport` dictionaries too.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NM_LENGTH = 16;

/** Injectable so tests can be deterministic; defaults to the platform CSPRNG. */
export type RandomBytes = (n: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (n) => {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
};

/** True when `value` is a well-formed `/NM`: exactly 16 uppercase letters. */
export function isValidNM(value: string): boolean {
  return /^[A-Z]{16}$/.test(value);
}

/**
 * Generate one `/NM`. Rejection-samples the CSPRNG so the 26 letters stay uniform
 * (256 % 26 !== 0, so plain modulo would bias A–H).
 */
export function generateNM(randomBytes: RandomBytes = defaultRandomBytes): string {
  const limit = 256 - (256 % ALPHABET.length); // 234
  let out = '';
  while (out.length < NM_LENGTH) {
    const chunk = randomBytes(NM_LENGTH);
    for (const byte of chunk) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === NM_LENGTH) break;
    }
  }
  return out;
}

/** Generate an `/NM` not already present in `taken`, and record it there. */
export function generateUniqueNM(taken: Set<string>, randomBytes?: RandomBytes): string {
  for (;;) {
    const candidate = generateNM(randomBytes);
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    return candidate;
  }
}
