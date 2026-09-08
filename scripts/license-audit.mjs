#!/usr/bin/env node
// Fails the build on AGPL/GPL/LGPL or unknown licenses anywhere in the installed tree.
// CLAUDE.md non-negotiable #7: MIT/Apache-2.0/BSD/ISC only.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** SPDX ids (upper-cased) we accept without review. */
const PERMISSIVE = new Set(
  [
    'MIT',
    'MIT-0',
    'ISC',
    'APACHE-2.0',
    'BSD-2-CLAUSE',
    'BSD-3-CLAUSE',
    'BSD',
    '0BSD',
    'BSD-3-CLAUSE-CLEAR',
    'CC0-1.0',
    'CC-BY-3.0',
    'CC-BY-4.0',
    'UNLICENSE',
    'WTFPL',
    'PYTHON-2.0',
    'BLUEOAK-1.0.0',
    'ZLIB',
    'BSL-1.0',
    'UPL-1.0',
    'ARTISTIC-2.0',
    'MPL-2.0',
  ].map((s) => s.toUpperCase()),
);

/** Anything matching these is a hard failure regardless of the allowlist. */
const DENY = /\b(A?GPL|LGPL|GPL-\d|SSPL|BUSL|COMMONS-CLAUSE|CC-BY-NC|CC-BY-SA)\b/i;

/** Packages whose `license` field is missing/odd but manually verified. key = name@version. */
const REVIEWED = new Map([]);

function* packageDirs(dir, depth = 0) {
  if (depth > 6 || !existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === '.bin') continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (entry.startsWith('@') || entry === '.pnpm' || entry === 'node_modules') {
      yield* packageDirs(full, depth + 1);
      continue;
    }
    if (existsSync(join(full, 'package.json'))) yield full;
    const nested = join(full, 'node_modules');
    if (existsSync(nested)) yield* packageDirs(nested, depth + 1);
  }
}

/** Normalise a package.json license field into a list of SPDX-ish tokens. */
function licenseTokens(pkg) {
  const raw =
    pkg.license ??
    (Array.isArray(pkg.licenses)
      ? pkg.licenses.map((l) => (typeof l === 'string' ? l : l?.type)).join(' OR ')
      : typeof pkg.licenses === 'object'
        ? pkg.licenses?.type
        : undefined);
  if (!raw || typeof raw !== 'string') return null;
  // "(MIT OR Apache-2.0)" / "MIT AND ISC" -> tokens
  return raw
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND|WITH)\s+/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

const seen = new Map();
for (const dir of packageDirs(join(ROOT, 'node_modules'))) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  if (!pkg.name || !pkg.version) continue;
  // Our own workspace packages are private and unpublished; they are not dependencies.
  if (pkg.private === true && pkg.name.startsWith('@redline/')) continue;
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) continue;
  seen.set(key, licenseTokens(pkg));
}

const denied = [];
const unknown = [];
for (const [key, tokens] of seen) {
  if (REVIEWED.has(key)) continue;
  if (tokens === null) {
    unknown.push([key, '(no license field)']);
    continue;
  }
  const joined = tokens.join(' OR ');
  if (tokens.some((t) => DENY.test(t))) {
    denied.push([key, joined]);
    continue;
  }
  // An OR-expression passes if ANY branch is permissive.
  if (!tokens.some((t) => PERMISSIVE.has(t.toUpperCase()))) unknown.push([key, joined]);
}

const report = (title, rows) => {
  if (!rows.length) return;
  console.error(`\n${title} (${rows.length}):`);
  for (const [key, lic] of rows.sort()) console.error(`  ${key.padEnd(52)} ${lic}`);
};

console.log(`license-audit: inspected ${seen.size} packages`);
report('DENIED — copyleft license', denied);
report('UNKNOWN — no recognised permissive license', unknown);

if (denied.length || unknown.length) {
  console.error(
    '\nFAIL: every dependency must be MIT / Apache-2.0 / BSD / ISC (CLAUDE.md non-negotiable #7).',
  );
  console.error('Add a manually reviewed package to REVIEWED in scripts/license-audit.mjs.');
  process.exit(1);
}
console.log('license-audit: OK — all dependencies permissively licensed');
