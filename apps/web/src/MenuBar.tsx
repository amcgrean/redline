/**
 * Menu bar (PLAN §3.11): File, Edit, View, Document, Help. Every entry is also reachable
 * from a toolbar button, panel or shortcut; the menus give the exports and the less
 * frequent document operations a findable home.
 */

import { useRef, useState } from 'react';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { actions, useEditorStore } from './store';

export interface MenuBarHandlers {
  onOpen: () => void;
  onSave: () => void;
  onPrint: () => void;
}

interface MenuDef {
  id: string;
  label: string;
  items: (ctx: {
    hasDoc: boolean;
    canUndo: boolean;
    canRedo: boolean;
    selected: number;
  }) => MenuItem[];
}

const MENUS = (h: MenuBarHandlers): MenuDef[] => [
  {
    id: 'file',
    label: 'File',
    items: ({ hasDoc }) => [
      { label: 'Open…', shortcut: 'Ctrl+O', onSelect: h.onOpen },
      { label: 'Save', shortcut: 'Ctrl+S', disabled: !hasDoc, onSelect: h.onSave },
      { label: 'Print…', shortcut: 'Ctrl+P', disabled: !hasDoc, onSelect: h.onPrint },
      { separator: true, label: '' },
      {
        label: 'Export flattened PDF…',
        disabled: !hasDoc,
        onSelect: () => void actions.exportFlattened(),
      },
      {
        label: 'Export current page as PNG…',
        disabled: !hasDoc,
        onSelect: () => void actions.exportPng(),
      },
      {
        label: 'Export markups summary (PDF)…',
        disabled: !hasDoc,
        onSelect: () => void actions.exportSummary(),
      },
      { label: 'Export markups CSV…', disabled: !hasDoc, onSelect: () => actions.exportCsv() },
      { label: 'Export markups XLSX…', disabled: !hasDoc, onSelect: () => actions.exportXlsx() },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: ({ hasDoc, canUndo, canRedo, selected }) => [
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !canUndo, onSelect: actions.undo },
      { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !canRedo, onSelect: actions.redo },
      { separator: true, label: '' },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !selected, onSelect: () => actions.copy() },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !hasDoc, onSelect: () => actions.paste() },
      {
        label: 'Duplicate',
        shortcut: 'Ctrl+D',
        disabled: !selected,
        onSelect: () => actions.duplicate(),
      },
      {
        label: 'Delete',
        shortcut: 'Del',
        disabled: !selected,
        danger: true,
        onSelect: () => actions.deleteMarkups(),
      },
      { separator: true, label: '' },
      {
        label: 'Select all on page',
        shortcut: 'Ctrl+A',
        disabled: !hasDoc,
        onSelect: () => actions.selectAllOnPage(),
      },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: ({ hasDoc }) => [
      {
        label: 'Fit page',
        shortcut: 'Shift+1',
        disabled: !hasDoc,
        onSelect: () => actions.setZoomMode('fit-page'),
      },
      {
        label: 'Fit width',
        shortcut: 'Shift+2',
        disabled: !hasDoc,
        onSelect: () => actions.setZoomMode('fit-width'),
      },
      { label: 'Zoom in', shortcut: 'Ctrl+=', disabled: !hasDoc, onSelect: actions.zoomIn },
      { label: 'Zoom out', shortcut: 'Ctrl+-', disabled: !hasDoc, onSelect: actions.zoomOut },
      {
        label: 'Rotate view',
        disabled: !hasDoc,
        onSelect: () => actions.rotateView(90),
      },
      { separator: true, label: '' },
      {
        label: 'Review mode',
        shortcut: 'Ctrl+Shift+F',
        disabled: !hasDoc,
        onSelect: () => actions.toggleReview(true),
      },
      { separator: true, label: '' },
      { label: 'Tools panel', shortcut: 'Ctrl+Shift+1', onSelect: () => actions.setPanel('tools') },
      {
        label: 'Markups list',
        shortcut: 'Ctrl+Shift+2',
        onSelect: () => actions.setPanel('markups'),
      },
      { label: 'Pages panel', shortcut: 'Ctrl+Shift+3', onSelect: () => actions.setPanel('pages') },
      {
        label: 'Properties',
        shortcut: 'Ctrl+Shift+4',
        onSelect: () => actions.setPanel('properties'),
      },
      { label: 'Measure', shortcut: 'Ctrl+Shift+5', onSelect: () => actions.setPanel('measure') },
    ],
  },
  {
    id: 'document',
    label: 'Document',
    items: ({ hasDoc }) => [
      {
        label: 'Calibrate scale…',
        shortcut: 'X',
        disabled: !hasDoc,
        onSelect: () => actions.setTool('calibrate'),
      },
      {
        label: 'Stamp all pages…',
        disabled: !hasDoc,
        onSelect: () => void actions.stampAllPages(),
      },
      { separator: true, label: '' },
      { label: 'Pages…', disabled: !hasDoc, onSelect: () => actions.setPanel('pages') },
      {
        label: 'Compress…',
        disabled: !hasDoc,
        onSelect: () => void actions.optimize(),
      },
      {
        label: 'Flatten copy…',
        disabled: !hasDoc,
        onSelect: () => void actions.exportFlattened(),
      },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    items: () => [
      { label: 'Keyboard shortcuts', shortcut: '?', onSelect: () => actions.toggleHelp(true) },
      { label: 'Profile…', onSelect: () => actions.toggleProfile(true) },
    ],
  },
];

export function MenuBar(handlers: MenuBarHandlers) {
  const hasDoc = useEditorStore((s) => s.hasDoc);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const selected = useEditorStore((s) => s.selectedIds.length);
  const [open, setOpen] = useState<{ id: string; x: number; y: number } | undefined>();
  const bar = useRef<HTMLDivElement>(null);
  const menus = MENUS(handlers);
  const current = menus.find((m) => m.id === open?.id);

  return (
    <div className="menubar" role="menubar" ref={bar}>
      {menus.map((m) => (
        <button
          key={m.id}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open?.id === m.id}
          className={open?.id === m.id ? 'open' : ''}
          onMouseDown={(e) => {
            // mousedown, not click: the menu's own outside-click closer runs on mousedown.
            e.preventDefault();
            e.stopPropagation();
            const box = e.currentTarget.getBoundingClientRect();
            setOpen(open?.id === m.id ? undefined : { id: m.id, x: box.left, y: box.bottom + 2 });
          }}
          onMouseEnter={(e) => {
            if (open && open.id !== m.id) {
              const box = e.currentTarget.getBoundingClientRect();
              setOpen({ id: m.id, x: box.left, y: box.bottom + 2 });
            }
          }}
        >
          {m.label}
        </button>
      ))}
      {open && current && (
        <ContextMenu
          x={open.x}
          y={open.y}
          items={current.items({ hasDoc, canUndo, canRedo, selected })}
          onClose={() => setOpen(undefined)}
        />
      )}
    </div>
  );
}
