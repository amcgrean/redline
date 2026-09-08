/**
 * Ownership rules. PLAN §3.4 "Ownership rule" and CLAUDE.md non-negotiable #4.
 *
 * On save, Redline rewrites ONLY the keys in `OWNED_KEYS`. Everything else in an
 * annotation dictionary — Bluebeam's `/BSI*`, `/RC`, `/DS`, `/IRT`, `/RT`, `/OC`,
 * `/Popup`, `/MeasurementTypes`, `/SlopeType`, `/PitchRun`, `/DepthUnit`, `/Label`,
 * `/Segments`, `/AlignOnSegment`, `/RiseDrop`, `/BM`, `/FillOpacity` and anything else
 * we have never seen — is left exactly as loaded.
 *
 * `/NM` is deliberately NOT owned: it is assigned once at creation and never regenerated.
 */

/** Keys Redline may rewrite on an existing annotation. */
export const OWNED_KEYS: readonly string[] = [
  'Rect',
  'L',
  'Vertices',
  'QuadPoints',
  'InkList',
  'CL',
  'C',
  'IC',
  'CA',
  'BS',
  'BE',
  'LE',
  'LL',
  'LLE',
  'Cap',
  'CP',
  'Contents',
  'Subj',
  'T',
  'M',
  'F',
  'DA',
  'DS',
  'RC',
  'IT',
  'Measure',
  'AP',
  'Popup',
  'RLTool',
  'RLAttrs',
];

const OWNED = new Set(OWNED_KEYS);

/** Keys only ever written when an annotation is created, never rewritten afterwards. */
export const CREATE_ONLY_KEYS: readonly string[] = ['NM', 'CreationDate', 'P', 'Type', 'Subtype'];

/**
 * Keys the corpus test asserts are byte-identical after a round trip. These carry data
 * Redline cannot reconstruct: Bluebeam custom columns, spaces, column definitions, rich
 * text, reply/group linkage and layer membership.
 */
export const MUST_NOT_CHANGE_KEYS: readonly string[] = [
  'BSIColumnData',
  'BSISpaces',
  'BSIAnnotColumns',
  'RC',
  'IRT',
  'RT',
  'OC',
  'GroupNesting',
  'NM',
  'CreationDate',
  'Popup',
];

export function isOwnedKey(key: string): boolean {
  return OWNED.has(key);
}

/**
 * `/RC` is owned but only as a mirror of `/Contents` (PLAN §3.6): if a markup already
 * carries rich text and Redline edits `/Contents`, `/RC` is rewritten to match. A markup
 * whose `/Contents` we did not touch keeps its `/RC` untouched.
 */
export function isContentsMirrorKey(key: string): boolean {
  return key === 'RC' || key === 'DS';
}
