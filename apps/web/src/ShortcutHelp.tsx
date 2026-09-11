/** `?` overlay: the keyboard map (PLAN Appendix B, the subset that exists). */

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Tools',
    rows: [
      ['V', 'Select'],
      ['H / hold Space / middle drag', 'Pan'],
      ['X', 'Calibrate scale'],
      ['M / Shift+M', 'Length / Polylength'],
      ['A / Shift+A', 'Area / Perimeter'],
      ['C', 'Count'],
      ['R / E', 'Rectangle / Ellipse'],
      ['L / Shift+L', 'Line / Arrow'],
      ['G / Shift+G', 'Polygon / Cloud'],
      ['P / Shift+H', 'Pen / Highlighter'],
      ['T / K / N', 'Text box / Callout / Note'],
      ['1–9', 'Tool chest quick slots'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
      ['Ctrl+C / Ctrl+V', 'Copy / Paste markups'],
      ['Ctrl+D', 'Duplicate'],
      ['Delete', 'Delete selection'],
      ['Ctrl+A', 'Select all on page'],
      ['Shift+click / drag on empty space', 'Add to selection / marquee'],
      ['Shift while drawing', 'Constrain to 45° / square'],
      ['Alt while drawing', 'Override snap for that point'],
      ['Double-click text', 'Edit text'],
      ['Enter / Esc', 'Finish / cancel a shape'],
      ['Ctrl+S', 'Save'],
    ],
  },
  {
    title: 'View',
    rows: [
      ['Scroll wheel', 'Zoom (Shift+wheel scrolls)'],
      ['Ctrl+= / Ctrl+-', 'Zoom in / out'],
      ['Shift+1 / Shift+2 / Ctrl+0', 'Fit page / Fit width / 100%'],
      ['PageUp / PageDown', 'Previous / next page'],
      ['Ctrl+F / Ctrl+P', 'Find / Print'],
      ['Ctrl+Shift+1…5', 'Tools / Markups / Pages / Properties / Measure'],
      ['?', 'This help'],
    ],
  },
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog" onClick={onClose}>
      <div
        className="shortcut-help"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcut-head">
          <strong>Keyboard shortcuts</strong>
          <button type="button" onClick={onClose} aria-label="Close shortcuts">
            ×
          </button>
        </div>
        <div className="shortcut-groups">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map(([keys, what]) => (
                  <div key={keys}>
                    <dt>{keys}</dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
