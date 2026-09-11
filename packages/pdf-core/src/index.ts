// Public surface of @redline/pdf-core. DOM-free; runs in Node under Vitest.

export type * from './types.js';
export { generateNM, generateUniqueNM, isValidNM } from './ids.js';

export { openDocument, requireMarkup, isPlaceholderId } from './document/open.js';
export { saveIncremental, markChanged } from './document/save.js';
export type { SaveResult, SaveOptions } from './document/save.js';

export {
  setPageScale,
  clearPageScale,
  readPageScale,
  parseMeasureDict,
} from './measure/viewport.js';
export { deleteMarkup, restoreMarkup, pageHasNoAnnots } from './annots/delete.js';
export {
  rotatePages,
  deletePages,
  movePages,
  insertBlankPage,
  insertPagesFrom,
  extractPages,
  mergeDocuments,
  saveFull,
  pageRotation,
} from './pages/ops.js';

export { duplicateMarkup, setMarkupLocked } from './annots/duplicate.js';
export type { DuplicateOptions } from './annots/duplicate.js';
export {
  addShapeMarkup,
  regenerateShapeAppearance,
  shapeAppearance,
  shapeBounds,
  DEFAULT_SHAPE_STYLE,
  DEFAULT_HIGHLIGHTER_STYLE,
} from './annots/shapes.js';
export type { ShapeKind, ShapeStyle, ShapeOptions, ShapeGeometry } from './annots/shapes.js';
export {
  addTextBox,
  addCallout,
  addNote,
  setMarkupText,
  calloutLeader,
  regenerateTextAppearance,
  textStyleOf,
  DEFAULT_TEXT_STYLE,
} from './annots/text.js';
export type { TextStyle, TextOptions, NoteOptions } from './annots/text.js';
export { wrapText, textBoxHeight, LINE_HEIGHT } from './annots/ap/text.js';
export type { TextAlign } from './annots/ap/text.js';
export {
  buildRectAppearance,
  buildEllipseAppearance,
  buildInkAppearance,
  buildCloudAppearance,
  cloudArcs,
  cloudOutline,
  cloudRadius,
} from './annots/ap/shapes.js';
export type { CloudArc } from './annots/ap/shapes.js';
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
  addPolylineMeasurement,
  addCountMarkup,
  countGroupOf,
  moveMarkup,
  updateMarkupProperties,
  setMarkupGeometry,
  canRegenerateAppearance,
  captionFor,
  DEFAULT_LENGTH_STYLE,
  DEFAULT_AREA_STYLE,
  DEFAULT_POLYLINE_STYLE,
  DEFAULT_COUNT_STYLE,
} from './annots/write.js';
export type {
  MeasurementOptions,
  MeasurementStyle,
  PolylineOptions,
  CountOptions,
  CountStyle,
  CountAttrs,
  MarkupPatch,
} from './annots/write.js';
export { OWNED_KEYS, MUST_NOT_CHANGE_KEYS, isOwnedKey } from './annots/ownership.js';
export { parseAnnotation, geometryBounds } from './annots/parse.js';
export {
  buildLineAppearance,
  buildPolygonAppearance,
  buildPolylineAppearance,
  buildCircleAppearance,
} from './annots/ap/measurement.js';
export { buildFormXObject } from './annots/ap/form.js';
export { pdfDate, parsePdfDate } from './annots/dict.js';
export {
  embedStampArtwork,
  addStamp,
  stampPages,
  stampMatrix,
  placementRect,
  rectAt,
} from './stamps/stamp.js';
export type {
  StampArtwork,
  StampSource,
  StampOptions,
  StampPlacement,
  StampCorner,
} from './stamps/stamp.js';
export { bakeFields, formatStampDate, formatStampTime } from './stamps/fields.js';
export type { FieldContext } from './stamps/fields.js';
export { BUILTIN_STAMPS, builtinStamp } from './stamps/library.js';
export type { BuiltinStamp } from './stamps/library.js';
export { flattenMarkups, appearanceMatrix } from './pages/flatten.js';
export type { FlattenOptions } from './pages/flatten.js';
export {
  optimizePdf,
  checkPdf,
  describeSavings,
  formatBytes,
  OPTIMIZE_ARGS,
} from './compress/optimize.js';
export type {
  QpdfRunner,
  QpdfResult,
  QpdfRunOptions,
  OptimizeOptions,
  OptimizeReport,
} from './compress/optimize.js';
export { createQpdfRunner } from './compress/emscripten.js';
export type {
  QpdfModule,
  QpdfModuleFactory,
  QpdfModuleOptions,
  EmscriptenFS,
} from './compress/emscripten.js';
