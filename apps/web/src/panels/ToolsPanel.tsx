/**
 * Tool Chest (PLAN §3.8): an ordered set of tools. Click a tool to draw with its subject and
 * style; keys 1–9 fire the first nine. Add from the selected markup, edit in place, remove,
 * export/import `*.toolchest.json`.
 */

import { useRef, useState } from 'react';
import type { Tool } from '@redline/toolchest';
import { actions, useEditor, useEditorStore } from '../store';
import { StampsSection } from './StampsSection';
import { ToolAttributesDialog } from './ToolAttributesDialog';
import { ContextMenu, type MenuItem } from '../ContextMenu';

const KIND_LABEL: Record<Tool['kind'], string> = {
  length: 'Length',
  polylength: 'Polylength',
  area: 'Area',
  perimeter: 'Perimeter',
  rectarea: 'Rect area',
  count: 'Count',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  polygon: 'Polygon',
  pen: 'Pen',
  textbox: 'Text box',
  callout: 'Callout',
  note: 'Note',
  cloud: 'Cloud',
  highlighter: 'Highlighter',
};

function ToolRow({ tool, index }: { tool: Tool; index: number }) {
  const activeToolId = useEditorStore((s) => s.activeToolId);
  const [editing, setEditing] = useState(false);
  const [attrsOpen, setAttrsOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const chestSize = useEditorStore((s) => s.chest?.tools.length ?? 0);
  const menuItems: MenuItem[] = [
    { label: 'Rename / subject…', onSelect: () => setEditing(true) },
    { label: 'Attributes & formulas…', onSelect: () => setAttrsOpen(true) },
    { label: 'Duplicate', onSelect: () => actions.duplicateTool(tool.id) },
    { separator: true, label: '' },
    { label: 'Move up', disabled: index === 0, onSelect: () => actions.moveTool(tool.id, -1) },
    {
      label: 'Move down',
      disabled: index >= chestSize - 1,
      onSelect: () => actions.moveTool(tool.id, 1),
    },
    { separator: true, label: '' },
    { label: 'Export chest…', onSelect: () => actions.exportToolChest() },
    { label: 'Remove', danger: true, onSelect: () => actions.removeTool(tool.id) },
  ];
  const [name, setName] = useState(tool.name);
  const [subject, setSubject] = useState(tool.subject);
  const active = tool.id === activeToolId;
  const slot = index < 9 ? String(index + 1) : undefined;

  const commit = () => {
    setEditing(false);
    if (name.trim() && subject.trim() && (name !== tool.name || subject !== tool.subject)) {
      actions.updateTool(tool.id, { name: name.trim(), subject: subject.trim() });
    }
  };

  return (
    <div
      className={`tool-row${active ? ' active' : ''}`}
      role="option"
      aria-selected={active}
      aria-label={tool.name}
      onClick={() => actions.selectTool(tool.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      <span className="tool-slot">{slot ?? ''}</span>
      <span
        className="tool-swatch"
        style={{
          borderColor: tool.style.stroke,
          background: tool.style.fill ? tool.style.fill : 'transparent',
          opacity: tool.style.fillOpacity ?? 1,
        }}
      />
      {editing ? (
        <span className="tool-edit" onClick={(e) => e.stopPropagation()}>
          <input
            value={name}
            aria-label="Tool name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
          />
          <input
            value={subject}
            aria-label="Tool subject"
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <button type="button" onClick={commit}>
            OK
          </button>
        </span>
      ) : (
        <span className="tool-text">
          <span className="tool-name">{tool.name}</span>
          <span className="muted small">
            {KIND_LABEL[tool.kind]} · {tool.subject}
          </span>
        </span>
      )}
      <span className="tool-actions" onClick={(e) => e.stopPropagation()}>
        <input
          type="color"
          aria-label={`Colour of ${tool.name}`}
          value={tool.style.stroke}
          onChange={(e) =>
            actions.updateTool(tool.id, {
              style: {
                ...tool.style,
                stroke: e.target.value,
                ...(tool.style.fill && { fill: e.target.value }),
              },
            })
          }
        />
        <button
          type="button"
          className="linklike"
          aria-label={`Edit ${tool.name} attributes`}
          title={
            tool.attributes.length || tool.formulas.length
              ? `${tool.attributes.length} attribute(s), ${tool.formulas.length} formula(s)`
              : 'Attributes and formulas'
          }
          onClick={() => setAttrsOpen(true)}
        >
          ƒ
        </button>
        {attrsOpen && <ToolAttributesDialog tool={tool} onClose={() => setAttrsOpen(false)} />}
        {menu && (
          <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(undefined)} />
        )}
        <button
          type="button"
          className="linklike"
          aria-label={`Remove ${tool.name}`}
          title="Remove from chest"
          onClick={() => actions.removeTool(tool.id)}
        >
          ×
        </button>
      </span>
    </div>
  );
}

export function ToolsPanel() {
  const chest = useEditorStore((s) => s.chest);
  const { doc, selectedId } = useEditor();
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = doc?.markups.find((m) => m.id === selectedId);

  if (!chest) return <div className="panel-empty">Loading tool chest…</div>;

  return (
    <div className="tools-panel">
      <div className="tools-head">
        <strong>{chest.name}</strong>
        <span className="muted small">{chest.tools.length} tools · keys 1–9</span>
      </div>
      <div className="tool-list" role="listbox" aria-label="Tool chest">
        {chest.tools.map((tool, i) => (
          <ToolRow key={tool.id} tool={tool} index={i} />
        ))}
        {chest.tools.length === 0 && (
          <div className="panel-empty">Empty. Select a markup and add it, or import a chest.</div>
        )}
      </div>
      <div className="tools-foot">
        <button
          type="button"
          disabled={!selected}
          onClick={() => selected && actions.addToolFromMarkup(selected.id)}
          title="Save the selected markup's subject and style as a tool"
        >
          Add to Tool Chest
        </button>
        <button
          type="button"
          onClick={() => actions.exportToolChest()}
          title="Download *.toolchest.json"
        >
          Export…
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          title="Load a *.toolchest.json"
        >
          Import…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Import tool chest"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) await actions.importToolChest(await file.text());
            e.target.value = '';
          }}
        />
      </div>
      <div className="muted small">Double-click a tool to rename it or change its subject.</div>
      <StampsSection />
    </div>
  );
}
