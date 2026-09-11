/**
 * Left tool rail (PLAN §3.11): every drawing tool as an icon button, grouped
 * select/measure/shape/text, with the keyboard hint in the tooltip. Accessible names are
 * the same labels the toolbar used to show ("Calibrate (X)"), so nothing else changes.
 */

import {
  Circle,
  Cloud,
  Crosshair,
  Hand,
  Hash,
  Hexagon,
  Highlighter,
  MessageSquare,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pen,
  Pentagon,
  Ruler,
  Spline,
  Square,
  SquareDashed,
  Stamp,
  StickyNote,
  TextCursor,
  Type,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { TOOLS } from './tools';
import { actions, useEditorStore, type Tool } from './store';

const ICONS: Record<Tool, LucideIcon> = {
  select: MousePointer2,
  pan: Hand,
  text: TextCursor,
  calibrate: Crosshair,
  length: Ruler,
  polylength: Spline,
  area: Pentagon,
  perimeter: Waypoints,
  rectarea: SquareDashed,
  count: Hash,
  rectangle: Square,
  ellipse: Circle,
  line: Minus,
  arrow: MoveUpRight,
  polygon: Hexagon,
  cloud: Cloud,
  pen: Pen,
  highlighter: Highlighter,
  textbox: Type,
  callout: MessageSquare,
  note: StickyNote,
  stamp: Stamp,
};

/** Tools after which a thin separator is drawn. */
const GROUP_ENDS = new Set<Tool>(['calibrate', 'count', 'highlighter']);

export function ToolRail() {
  const tool = useEditorStore((s) => s.tool);
  const hasDoc = useEditorStore((s) => s.hasDoc);
  return (
    <div className="tool-rail" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {TOOLS.map((t) => {
        const Icon = ICONS[t.id];
        return (
          <span key={t.id} className="tool-rail-item">
            <button
              type="button"
              className={tool === t.id ? 'active' : ''}
              disabled={!hasDoc}
              aria-label={t.label}
              title={`${t.label} — ${t.hint}`}
              aria-pressed={tool === t.id}
              onClick={() => actions.setTool(t.id)}
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {GROUP_ENDS.has(t.id) && <span className="tool-rail-sep" />}
          </span>
        );
      })}
    </div>
  );
}
