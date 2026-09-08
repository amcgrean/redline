# Redline

Browser-native PDF markup, measurement and page tools for construction offices. Read
`CLAUDE.md` and `docs/PLAN.md` first; `docs/POC-RESULTS.md` says where the proof of concept
stands and what still needs checking in Revu.

## Layout

```
apps/web            Vite + React demo (drop zone, tiled pdf.js viewer, Konva markup layer,
                    Calibrate / Length / Area, Save)
packages/pdf-core   DOM-free engine: parse, /Measure + /VP, measurement writers, AP generators,
                    incremental save. Tested in Node with Vitest and pdf.js.
fixtures/           Real PDFs (read-only). fixtures/out/ holds generated files for manual checks.
docs/               PLAN.md, POC-KICKOFF.md, POC-RESULTS.md, interop-checklist.md, adr/
```

## Commands

```bash
pnpm i               # install (Node 22 recommended; Node 20.14 works with polyfills in tests)
pnpm dev             # demo at http://localhost:5173 — add ?fixture=<file in fixtures/> to auto-open
pnpm test            # pdf-core unit tests (dictionary + PNG snapshots)
pnpm test:corpus     # round-trip every fixture; writes fixtures/out/corpus/
pnpm fixtures:out    # regenerate fixtures/out/ (spike file + corpus)
pnpm lint && pnpm typecheck
pnpm license-audit   # fails on AGPL/GPL/unknown
```

In the demo: **V** select, **X** calibrate, **M** length, **A** area, **Ctrl+S** save,
Ctrl+wheel zoom. "Open (save in place)…" uses the File System Access API on Chrome/Edge so
Save writes back to the same file; otherwise Save downloads `<name>.redline.pdf`. With
`?fixture=`, Save also drops a copy in `fixtures/out/browser/`.
