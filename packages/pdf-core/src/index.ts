// Public surface of @redline/pdf-core. DOM-free; runs in Node under Vitest.

export type * from './types.js';
export { generateNM, generateUniqueNM, isValidNM } from './ids.js';

export { openDocument, requireMarkup, isPlaceholderId } from './document/open.js';
export { saveIncremental, markChanged } from './document/save.js';
export type { SaveResult } from './document/save.js';

export { setPageScale, readPageScale, parseMeasureDict } from './measure/viewport.js';
export { buildMeasureDict } from './measure/measureDict.js';
export { computeMeasurement } from './measure/compute.js';
export {
  formatFeetInches,
  formatInches,
  formatDecimal,
  formatLength,
  formatArea,
  scaleRatioString,
  splitInchFraction,
  FRACTION_DENOMINATORS,
} from './measure/format.js';
export { worldUnitsPerPoint, convertWorld, displayUnit, areaUnitLabel } from './measure/units.js';
export * from './measure/geometry.js';

export {
  addLengthMeasurement,
  addAreaMeasurement,
  moveMarkup,
  captionFor,
  DEFAULT_LENGTH_STYLE,
  DEFAULT_AREA_STYLE,
} from './annots/write.js';
export type { MeasurementOptions, MeasurementStyle } from './annots/write.js';
export { OWNED_KEYS, MUST_NOT_CHANGE_KEYS, isOwnedKey } from './annots/ownership.js';
export { parseAnnotation, geometryBounds } from './annots/parse.js';
export { buildLineAppearance, buildPolygonAppearance } from './annots/ap/measurement.js';
export { buildFormXObject } from './annots/ap/form.js';
export { pdfDate, parsePdfDate } from './annots/dict.js';
