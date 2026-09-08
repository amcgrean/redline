/**
 * Deterministic text serialisation of pdf-lib objects, for dictionary snapshots and for
 * the corpus "only owned keys changed" diff.
 *
 * References are inlined (depth-limited, cycle-guarded) so a snapshot reads as one
 * self-contained dictionary and does not depend on object numbers. `/P` (the page) and
 * `/Popup`/`/IRT` (sibling annotations) are printed as `ref` markers rather than
 * expanded, because expanding them would pull in the whole page tree.
 */

import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFContext,
  type PDFObject,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';

/** Keys whose referenced object is not expanded. */
const REF_ONLY_KEYS = new Set(['P', 'Popup', 'IRT', 'Parent', 'Dest', 'A', 'OC', 'Pg']);

export interface SerializeOptions {
  /** Inline referenced objects up to this depth. */
  depth?: number;
  /** Decode and include stream contents. */
  streams?: boolean;
  /** Keys to leave out entirely (e.g. volatile timestamps). */
  omit?: string[];
}

function fmtNumber(n: number): string {
  // Collapse float noise so 0.05555556 and 0.0555555600000001 compare equal.
  return String(Number(n.toPrecision(10)));
}

function serializeString(value: PDFString | PDFHexString): string {
  const text = value.decodeText();
  return `(${text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

export function serialize(
  obj: PDFObject | undefined,
  context: PDFContext,
  options: SerializeOptions = {},
  indent = '',
  seen: Set<string> = new Set(),
  parentKey?: string,
): string {
  const depth = options.depth ?? 4;
  if (obj === undefined) return 'undefined';
  if (obj instanceof PDFRef) {
    const key = obj.toString();
    if ((parentKey && REF_ONLY_KEYS.has(parentKey)) || depth <= 0 || seen.has(key)) {
      return `ref(${obj.objectNumber})`;
    }
    const target = context.lookup(obj);
    if (!target) return `ref(${obj.objectNumber} -> missing)`;
    const nextSeen = new Set(seen);
    nextSeen.add(key);
    return serialize(
      target,
      context,
      { ...options, depth: depth - 1 },
      indent,
      nextSeen,
      parentKey,
    );
  }
  if (obj instanceof PDFName) return obj.toString();
  if (obj instanceof PDFNumber) return fmtNumber(obj.asNumber());
  if (obj instanceof PDFBool) return String(obj.asBoolean());
  if (obj === PDFNull) return 'null';
  if (obj instanceof PDFString || obj instanceof PDFHexString) return serializeString(obj);
  if (obj instanceof PDFArray) {
    const items: string[] = [];
    for (let i = 0; i < obj.size(); i += 1) {
      items.push(serialize(obj.get(i), context, options, `${indent}  `, seen, parentKey));
    }
    const flat = items.join(' ');
    if (flat.length < 90 && !flat.includes('\n')) return `[ ${flat} ]`;
    return `[\n${items.map((s) => `${indent}  ${s}`).join('\n')}\n${indent}]`;
  }
  if (obj instanceof PDFStream) {
    const dict = serializeDict(obj.dict, context, options, indent, seen);
    if (!options.streams) return `stream ${dict}`;
    let content: string;
    if (obj instanceof PDFRawStream) {
      try {
        content = Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1');
      } catch {
        content = `<undecodable ${obj.getContents().length} bytes>`;
      }
    } else {
      content = Buffer.from(obj.getContents()).toString('latin1');
    }
    const body = content
      .split('\n')
      .map((line) => `${indent}  | ${line}`)
      .join('\n');
    return `stream ${dict}\n${body}`;
  }
  if (obj instanceof PDFDict) return serializeDict(obj, context, options, indent, seen);
  return obj.toString();
}

export function serializeDict(
  dict: PDFDict,
  context: PDFContext,
  options: SerializeOptions = {},
  indent = '',
  seen: Set<string> = new Set(),
): string {
  const omit = new Set(options.omit ?? []);
  const keys = [...dict.keys()]
    .map((k) => k.asString().replace(/^\//, ''))
    .filter((k) => !omit.has(k))
    .sort();
  if (keys.length === 0) return '<< >>';
  const lines = keys.map((key) => {
    const value = serialize(dict.get(PDFName.of(key)), context, options, `${indent}  `, seen, key);
    return `${indent}  /${key} ${value}`;
  });
  return `<<\n${lines.join('\n')}\n${indent}>>`;
}

/** Per-key serialisation of one dictionary, for diffing. */
export function keyMap(
  dict: PDFDict,
  context: PDFContext,
  options: SerializeOptions = {},
): Map<string, string> {
  const out = new Map<string, string>();
  for (const key of dict.keys()) {
    const name = key.asString().replace(/^\//, '');
    out.set(name, serialize(dict.get(key), context, options, '', new Set(), name));
  }
  return out;
}

/** Keys whose serialised value differs (or that exist on only one side). */
export function changedKeys(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((k) => before.get(k) !== after.get(k)).sort();
}
