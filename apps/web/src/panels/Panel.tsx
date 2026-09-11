/**
 * The right-hand panel (PLAN §3.11): tabs for Measure, Markups, Pages and Properties,
 * collapsible to a rail. Ctrl+Shift+1..4 jump to a tab.
 */

import type { PdfjsDocument } from '../pdfjs';
import { actions, useEditorStore, type PanelTab } from '../store';
import { MeasurePanel } from './MeasurePanel';
import { ToolsPanel } from './ToolsPanel';
import { MarkupsPanel } from './MarkupsPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { Thumbnails } from '../Thumbnails';

export const PANEL_TABS: { id: PanelTab; label: string; key: string }[] = [
  { id: 'tools', label: 'Tools', key: 'Ctrl+Shift+1' },
  { id: 'markups', label: 'Markups', key: 'Ctrl+Shift+2' },
  { id: 'pages', label: 'Pages', key: 'Ctrl+Shift+3' },
  { id: 'properties', label: 'Properties', key: 'Ctrl+Shift+4' },
  { id: 'measure', label: 'Measure', key: 'Ctrl+Shift+5' },
];

export function Panel({ pdfjs }: { pdfjs: PdfjsDocument }) {
  const open = useEditorStore((s) => s.panel.open);
  const tab = useEditorStore((s) => s.panel.tab);

  return (
    <div className={`panel${open ? '' : ' collapsed'}`} role="complementary" aria-label="Panel">
      <div className="panel-tabs" role="tablist" aria-label="Panel tabs">
        {PANEL_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={open && tab === t.id}
            className={`panel-tab${open && tab === t.id ? ' active' : ''}`}
            title={t.key}
            onClick={() => actions.setPanel(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className="panel-collapse"
          aria-label={open ? 'Collapse panel' : 'Expand panel'}
          title={open ? 'Collapse' : 'Expand'}
          onClick={() => actions.togglePanel()}
        >
          {open ? '»' : '«'}
        </button>
      </div>
      {open && (
        <div className="panel-body" role="tabpanel">
          {tab === 'tools' && <ToolsPanel />}
          {tab === 'measure' && <MeasurePanel />}
          {tab === 'markups' && <MarkupsPanel />}
          {tab === 'pages' && <Thumbnails pdfjs={pdfjs} />}
          {tab === 'properties' && <PropertiesPanel />}
        </div>
      )}
    </div>
  );
}
